import { describe, expect, it } from 'vitest';
import { issueCommand } from '../src/sim/commands';
import { castPower } from '../src/sim/powers';
import {
  defect, envoyTick, isAllianceVictory, loyaltyTarget, persuadeChance, sendEnvoy,
} from '../src/sim/systems/diplomacy';
import { getTreaty, setTreaty } from '../src/sim/systems/treaties';
import { areHostile, centerOf, hqOf, nearestEnemyUnit, spawnUnit } from '../src/sim/util';
import { ALLIANCE_HOLD_TICKS, createWorld, step } from '../src/sim/world';

describe('外交狀態', () => {
  it('開局所有陣營互相交戰，和平或同盟後就不再敵對', () => {
    const w = createWorld(1);
    expect(areHostile(w, 0, 1)).toBe(true);
    setTreaty(w, 0, 1, 'peace');
    expect(areHostile(w, 0, 1)).toBe(false);
    expect(areHostile(w, 1, 0)).toBe(false);
    expect(areHostile(w, 0, 2)).toBe(true);
  });

  it('和平的陣營不會攻擊彼此的小人', () => {
    const w = createWorld(1);
    const a = w.units.find((u) => u.factionId === 0)!;
    const b = w.units.find((u) => u.factionId === 1)!;
    for (const f of w.factions) setTreaty(w, 0, f.id, 'peace');
    b.x = a.x + 1;
    b.y = a.y;
    expect(nearestEnemyUnit(w, a, 5)?.factionId).not.toBe(1);
  });

  it('對和平的對象下令進攻會撕毀和約', () => {
    const w = createWorld(1);
    setTreaty(w, 0, 1, 'peace');
    issueCommand(w, 0, { type: 'setStance', stance: 'attack', target: 1 });
    step(w);
    expect(getTreaty(w, 0, 1)).toBe('war');
    expect(w.events.some((e) => e.kind === 'diplomacy' && e.text.includes('宣戰'))).toBe(true);
  });

  it('全員同盟維持夠久就是結盟共治勝利', () => {
    const w = createWorld(1, { rules: { peaceMinutes: 30 } });
    for (const a of w.factions) for (const b of w.factions) setTreaty(w, a.id, b.id, 'alliance');
    for (const f of w.factions) f.nextDiplomacyAt = Infinity; // 不讓 AI 背盟
    expect(isAllianceVictory(w)).toBe(true);
    for (let i = 0; i <= ALLIANCE_HOLD_TICKS && !w.over; i++) step(w);
    expect(w.over).toBe(true);
    expect(w.endReason).toContain('結盟共治');
  });
});

describe('出使', () => {
  it('外交官抵達對方營帳後會帶回結果，途中享有外交豁免', () => {
    const w = createWorld(2);
    const f = w.factions[0];
    const envoy = spawnUnit(w, f, 'diplomat')!;
    envoy.attrs.cha = 20;
    expect(sendEnvoy(w, f, 1, 'peace')).toBe(true);
    expect(envoy.action.type).toBe('envoy');

    const enemy = w.units.find((u) => u.factionId === 1)!;
    enemy.x = envoy.x + 1;
    enemy.y = envoy.y;
    expect(nearestEnemyUnit(w, enemy, 5)?.id).not.toBe(envoy.id);

    const target = centerOf(hqOf(w, w.factions[1])!);
    envoy.x = target.x + 1;
    envoy.y = target.y;
    envoyTick(w, envoy);
    expect(envoy.action.type === 'envoy' && envoy.action.returning).toBe(true);
    expect(w.events.some((e) => e.kind === 'diplomacy')).toBe(true);
  });

  it('沒有外交官就無法出使', () => {
    const w = createWorld(2);
    expect(sendEnvoy(w, w.factions[0], 1, 'peace')).toBe(false);
  });
});

describe('策反與忠誠', () => {
  it('魅力高的人比較忠誠；挨餓會動搖忠誠', () => {
    const w = createWorld(3);
    const u = w.units[0];
    u.attrs.cha = 6;
    const low = loyaltyTarget(w, u);
    u.attrs.cha = 16;
    const high = loyaltyTarget(w, u);
    expect(high).toBeGreaterThan(low);
    u.hunger = 1;
    expect(loyaltyTarget(w, u)).toBeLessThan(high);
  });

  it('魅力高的外交官比較容易說服；對方越忠誠越難', () => {
    const w = createWorld(3);
    const [d, t] = w.units;
    d.attrs.cha = 8;
    t.loyalty = 50;
    const weak = persuadeChance(w, d, t);
    d.attrs.cha = 16;
    expect(persuadeChance(w, d, t)).toBeGreaterThan(weak);
    t.loyalty = 90;
    expect(persuadeChance(w, d, t)).toBeLessThan(persuadeChance(w, d, { ...t, loyalty: 40 }));
  });

  it('策反關閉時成功率為 0', () => {
    const w = createWorld(3, { rules: { subvertMult: 0 } });
    expect(persuadeChance(w, w.units[0], w.units[10])).toBe(0);
  });

  it('倒戈的小人帶著裝備改投新陣營', () => {
    const w = createWorld(4);
    const d = spawnUnit(w, w.factions[0], 'diplomat')!;
    const t = w.units.find((u) => u.factionId === 1 && u.role === 'warrior')!;
    const weapon = t.weapon;
    defect(w, t, d);
    expect(t.factionId).toBe(0);
    expect(t.weapon).toBe(weapon);
    expect(w.factions[0].stats.recruited).toBe(1);
    expect(w.factions[1].stats.defected).toBe(1);
  });
});

describe('外交神力', () => {
  it('神諭和平讓最近的陣營與所有敵人停戰，期滿恢復交戰', () => {
    const w = createWorld(5, { rules: { infiniteMana: true } });
    const f = w.factions[0];
    const c = centerOf(hqOf(w, f)!);
    expect(castPower(w, 'truce', c.x, c.y).ok).toBe(true);
    for (const o of w.factions) if (o.id !== f.id) expect(getTreaty(w, f.id, o.id)).toBe('peace');
    w.tick = w.truceUntil[f.id][1] - 1;
    step(w);
    step(w);
    expect(getTreaty(w, f.id, 1)).toBe('war');
  });

  it('挑撥離間撕毀所有條約', () => {
    const w = createWorld(5, { rules: { infiniteMana: true } });
    setTreaty(w, 0, 1, 'alliance');
    const c = centerOf(hqOf(w, w.factions[0])!);
    castPower(w, 'discord', c.x, c.y);
    expect(getTreaty(w, 0, 1)).toBe('war');
  });
});
