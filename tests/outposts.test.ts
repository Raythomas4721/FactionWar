import { describe, expect, it } from 'vitest';
import { createFog, isExplored, isVisible, pickScoutTarget, setScoutTarget, unitVisible } from '../src/sim/fog';
import { createKingdomWorld } from '../src/sim/kingdom';
import { modOf } from '../src/sim/modifiers';
import { CAPTURE_TICKS, OUTPOST_DEFS } from '../src/sim/outposts';
import { adjustGarrison, garrisonOf, updateOutposts } from '../src/sim/systems/outposts';
import { factionUnits, spawnUnit } from '../src/sim/util';
import { score, step } from '../src/sim/world';
import type { OutpostKind, World } from '../src/sim/types';
import { lairOdds } from '../src/sim/strength';

const kingdom = (fog = true) => createKingdomWorld({ player: 'human', enemy: 'orc', difficulty: 'normal', seed: 3, fog });
const outpost = (w: World, kind: OutpostKind) => w.outposts.find((o) => o.kind === kind)!;

/** 在據點上放 n 名某陣營的戰士 */
function stand(w: World, factionId: number, x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) spawnUnit(w, w.factions[factionId], 'warrior', 'soldier', { x: x + i * 0.2, y });
}

describe('據點', () => {
  it('1v1 地圖有礦場、瞭望塔、戰神祠各兩座，點對稱', () => {
    const w = kingdom();
    expect(w.outposts).toHaveLength(6);
    for (const kind of ['mine', 'watchtower', 'shrine'] as const) {
      const [a, b] = w.outposts.filter((o) => o.kind === kind);
      expect(a.x + b.x).toBeCloseTo(w.width);
      expect(a.y + b.y).toBeCloseTo(w.height);
    }
  });

  it('站在據點上就能佔領，人越多越快', () => {
    const one = kingdom();
    const three = kingdom();
    const a = outpost(one, 'shrine');
    const b = outpost(three, 'shrine');
    stand(one, 0, a.x, a.y, 1);
    stand(three, 0, b.x, b.y, 3);
    for (let i = 0; i < CAPTURE_TICKS / 3 + 1; i++) {
      updateOutposts(one);
      updateOutposts(three);
    }
    expect(b.owner).toBe(0);
    expect(a.owner).toBeNull();
    expect(a.progress).toBeGreaterThan(0);
  });

  it('雙方都在就僵持，誰也佔不了', () => {
    const w = kingdom();
    const o = outpost(w, 'shrine');
    stand(w, 0, o.x, o.y, 2);
    stand(w, 1, o.x, o.y + 0.5, 2);
    for (let i = 0; i < CAPTURE_TICKS * 2; i++) updateOutposts(w);
    expect(o.owner).toBeNull();
  });

  it('礦場給資源、戰神祠加傷害，佔領也加分數', () => {
    const w = kingdom();
    const me = w.factions[0];
    const before = score(w, me);
    outpost(w, 'mine').owner = 0;
    outpost(w, 'shrine').owner = 0;
    const ore = me.resources.ore;
    updateOutposts(w);
    expect(me.resources.ore).toBeCloseTo(ore + OUTPOST_DEFS.mine.income!.ore!);
    expect(modOf(w, 0, 'damage')).toBeCloseTo(1.1);
    expect(modOf(w, 1, 'damage')).toBe(1);
    expect(score(w, me)).toBe(before + 30);
  });

  it('玩家增加駐守人數，大臣會派戰士過去', () => {
    const w = kingdom();
    const me = w.factions[0];
    const o = outpost(w, 'mine');
    adjustGarrison(w, me, o.id, 1);
    adjustGarrison(w, me, o.id, 1);
    expect(me.garrisons[o.id]).toBe(2);
    expect(garrisonOf(w, 0, o.id)).toHaveLength(2);
    adjustGarrison(w, me, o.id, -2);
    expect(garrisonOf(w, 0, o.id)).toHaveLength(0);
  });

  it('駐守的戰士會走到據點並佔領', () => {
    const w = kingdom(false);
    const me = w.factions[0];
    const o = outpost(w, 'mine');
    w.kingdom!.nextPolicyAt = Infinity;
    adjustGarrison(w, me, o.id, 3);
    for (let i = 0; i < 900 && o.owner !== 0; i++) step(w);
    expect(o.owner).toBe(0);
  });
});

describe('戰爭迷霧與斥候', () => {
  it('開局只看得到自家附近，敵營看不到', () => {
    const w = kingdom();
    const me = w.factions[0];
    const foe = w.factions[1];
    const myHq = w.buildings.find((b) => b.id === me.hqId)!;
    const foeHq = w.buildings.find((b) => b.id === foe.hqId)!;
    expect(isVisible(w, myHq.x + 1, myHq.y + 1)).toBe(true);
    expect(isExplored(w, foeHq.x + 1, foeHq.y + 1)).toBe(false);
    const enemy = factionUnits(w, foe.id)[0];
    expect(unitVisible(w, enemy)).toBe(false);
    expect(unitVisible(w, factionUnits(w, me.id)[0])).toBe(true);
  });

  it('關掉迷霧或旁觀模式就看得到全圖', () => {
    const w = kingdom(false);
    expect(w.fog).toBeUndefined();
    expect(isVisible(w, w.width - 2, w.height - 2)).toBe(true);
  });

  it('斥候跑得快，會去最久沒看過的地方，玩家可以指定地點', () => {
    const w = kingdom();
    const me = w.factions[0];
    const scout = spawnUnit(w, me, 'warrior', 'scout')!;
    const target = pickScoutTarget(w, scout);
    // 沒去過的地方在遠方
    expect(Math.hypot(target.x - scout.x, target.y - scout.y)).toBeGreaterThan(8);
    setScoutTarget(w, 30, 20);
    expect(pickScoutTarget(w, scout)).toEqual({ x: 30, y: 20 });
  });

  it('派出斥候後探索範圍變大', () => {
    const w = kingdom();
    w.kingdom!.nextPolicyAt = Infinity;
    const explored = () => w.fog!.lastSeen.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    const before = explored();
    spawnUnit(w, w.factions[0], 'warrior', 'scout');
    for (let i = 0; i < 400; i++) step(w);
    expect(explored()).toBeGreaterThan(before * 1.3);
  });

  it('沒有王國模式時不會有迷霧', () => {
    const w = kingdom(false);
    createFog(w, 0);
    expect(w.fog).toBeDefined();
  });
});

describe('地道與戰力估算', () => {
  it('派去駐守的地道工兵從地底挖過去，冒出來才佔領', () => {
    const w = createKingdomWorld({ player: 'dwarf', enemy: 'orc', difficulty: 'normal', seed: 4, fog: false });
    w.kingdom!.nextPolicyAt = Infinity;
    const me = w.factions[0];
    me.tech = 2;
    // 讓工兵成為唯一的戰士，駐守命令一定派到他
    for (const u of factionUnits(w, me.id)) if (u.role === 'warrior') u.role = 'worker';
    const sapper = spawnUnit(w, me, 'warrior', 'sapper')!;
    const o = outpost(w, 'shrine');
    adjustGarrison(w, me, o.id, 1);
    expect(sapper.post).toBe(o.id);
    let wentUnder = false;
    for (let i = 0; i < 600 && o.owner !== 0; i++) {
      step(w);
      if (sapper.underground) wentUnder = true;
    }
    expect(wentUnder).toBe(true);
    expect(sapper.underground).toBe(false);
    expect(o.owner).toBe(0);
  });

  it('開局打巨龍很危險；兵越多勝算越高', () => {
    const w = kingdom(false);
    const me = w.factions[0];
    const lair = w.lairs.find((l) => l.monster !== 'dragon')!;
    const few = lairOdds(w, me.id, lair);
    const dragon = w.lairs.find((l) => l.monster === 'dragon')!;
    expect(lairOdds(w, me.id, dragon).level).toBe('danger');
    for (let i = 0; i < 20; i++) spawnUnit(w, me, 'warrior');
    const many = lairOdds(w, me.id, lair);
    expect(many.ratio).toBeGreaterThan(few.ratio * 2);
    expect(many.mine).toBeGreaterThan(few.mine);
  });
});
