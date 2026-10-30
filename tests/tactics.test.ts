import { describe, expect, it } from 'vitest';
import { think } from '../src/sim/ai/utility';
import { issueCommand } from '../src/sim/commands';
import { createKingdomWorld } from '../src/sim/kingdom';
import { modOf } from '../src/sim/modifiers';
import { abilityCooldown, musterPoint, pickFocusTarget, useAbility } from '../src/sim/tactics';
import { factionUnits, spawnUnit } from '../src/sim/util';
import { step } from '../src/sim/world';
import { dist } from '../src/sim/math';

const kingdom = () => {
  const w = createKingdomWorld({ player: 'human', enemy: 'orc', difficulty: 'normal', seed: 3, fog: false });
  w.kingdom!.nextPolicyAt = Infinity;
  w.kingdom!.aiNextPolicyAt = Infinity;
  return w;
};

describe('戰術指令', () => {
  it('衝鋒號加速、加傷害，用完要等冷卻', () => {
    const w = kingdom();
    const me = w.factions[0];
    expect(useAbility(w, me, 'charge')).toBe(true);
    expect(modOf(w, me.id, 'speed')).toBeCloseTo(1.3);
    expect(modOf(w, me.id, 'damage')).toBeCloseTo(1.1);
    expect(abilityCooldown(w, me, 'charge')).toBeGreaterThan(0);
    expect(useAbility(w, me, 'charge')).toBe(false);
    // 盾牆是另一個指令，可以同時用
    expect(useAbility(w, me, 'shieldwall')).toBe(true);
    expect(modOf(w, me.id, 'defense')).toBeCloseTo(0.7);
  });

  it('鳴金收兵：改成防守，進攻中的戰士全部撤回', () => {
    const w = kingdom();
    const me = w.factions[0];
    w.tick = 5000;
    issueCommand(w, me.id, { type: 'setStance', stance: 'attack', target: 1 });
    step(w);
    expect(me.stance).toBe('attack');
    useAbility(w, me, 'recall');
    expect(me.stance).toBe('defend');
    const warriors = factionUnits(w, me.id).filter((u) => u.role === 'warrior');
    for (const u of warriors) think(w, u);
    expect(warriors.every((u) => u.action.type === 'retreat')).toBe(true);
  });
});

describe('戰術設定', () => {
  it('集火英雄：比較遠的英雄也會先打', () => {
    const w = kingdom();
    const me = w.factions[0];
    const u = factionUnits(w, me.id).find((x) => x.role === 'warrior')!;
    const near = spawnUnit(w, w.factions[1], 'warrior', 'soldier', { x: u.x + 2, y: u.y })!;
    const hero = spawnUnit(w, w.factions[1], 'warrior', 'soldier', { x: u.x + 5, y: u.y })!;
    hero.hero = { ...(hero.hero ?? {}), title: '測試' } as never;
    expect(pickFocusTarget(w, u, 'nearest')).toBe(near);
    expect(pickFocusTarget(w, u, 'heroes')).toBe(hero);
  });

  it('補刀：先打血少的', () => {
    const w = kingdom();
    const me = w.factions[0];
    const u = factionUnits(w, me.id).find((x) => x.role === 'warrior')!;
    spawnUnit(w, w.factions[1], 'warrior', 'soldier', { x: u.x + 2, y: u.y });
    const weak = spawnUnit(w, w.factions[1], 'warrior', 'soldier', { x: u.x + 4, y: u.y })!;
    weak.hp = 3;
    expect(pickFocusTarget(w, u, 'weakest')).toBe(weak);
  });

  it('死戰的傷兵不撤退，保守的會', () => {
    const w = kingdom();
    const me = w.factions[0];
    const u = factionUnits(w, me.id).find((x) => x.role === 'warrior')!;
    u.hp = u.maxHp * 0.45;
    // 在野外遇到敵人（不是保衛營帳）：死戰的會上前迎戰
    u.x = 20.5;
    u.y = 10.5;
    spawnUnit(w, w.factions[1], 'warrior', 'soldier', { x: u.x + 4, y: u.y });
    me.tactics = { ...me.tactics, retreat: 'cautious' };
    think(w, u);
    expect(u.action.type).toBe('retreat');
    u.action = { type: 'idle' };
    me.tactics = { ...me.tactics, retreat: 'fierce' };
    think(w, u);
    expect(u.action.type).not.toBe('retreat');
  });

  it('集結進攻：先在前線集合，人到齊才出發', () => {
    const w = kingdom();
    const me = w.factions[0];
    me.tactics = { ...me.tactics, muster: true };
    w.tick = 5000;
    issueCommand(w, me.id, { type: 'setStance', stance: 'attack', target: 1 });
    step(w);
    expect(me.musterAt).not.toBeNull();
    const rally = musterPoint(w, me)!;
    const u = factionUnits(w, me.id).find((x) => x.role === 'warrior' && x.post === undefined)!;
    think(w, u);
    expect(u.action.type).toBe('guard');
    if (u.action.type === 'guard') expect(dist(u.action.x, u.action.y, rally.x, rally.y)).toBeLessThan(3);
    for (let i = 0; i < 600 && me.musterAt !== null; i++) step(w);
    expect(me.musterAt).toBeNull();
  });
});
