import { describe, expect, it } from 'vitest';
import { issueCommand } from '../src/sim/commands';
import { canExpand, expandKingdom, EXPANDED_H, EXPANDED_W } from '../src/sim/expansion';
import { createKingdomWorld, kingdomOutcome } from '../src/sim/kingdom';
import { dist } from '../src/sim/math';
import { trainShip, updateNaval } from '../src/sim/naval';
import { docksOf, findDockSpot, hasSea, isSea } from '../src/sim/sea';
import { damageBuilding } from '../src/sim/systems/combat';
import { createBuilding, findBuildSpot, placeBuilding } from '../src/sim/systems/building';
import { findPath } from '../src/sim/systems/movement';
import { canEngage } from '../src/sim/naval';
import { factionUnits, hqOf, spawnUnit } from '../src/sim/util';
import { step } from '../src/sim/world';
import type { World } from '../src/sim/types';

/** 第一章打贏的世界：直接拆掉敵方營帳（玩家多蓋幾間房子，人口才夠造船） */
function wonChapterOne(): World {
  const w = createKingdomWorld({ player: 'human', enemy: 'orc', difficulty: 'normal', seed: 5, fog: false });
  w.kingdom!.nextPolicyAt = Infinity;
  w.kingdom!.aiNextPolicyAt = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = findBuildSpot(w, w.factions[0])!;
    createBuilding(w, w.factions[0], 'house', p.x, p.y, true);
  }
  const foeHq = hqOf(w, w.factions[1])!;
  damageBuilding(w, foeHq, 99999, 0);
  step(w);
  return w;
}

/** 擴張後，給玩家蓋好碼頭 */
function expandedWithDock(): World {
  const w = wonChapterOne();
  expandKingdom(w);
  const me = w.factions[0];
  const spot = findDockSpot(w, me)!;
  createBuilding(w, me, 'dock', spot.x, spot.y, true);
  me.tech = 2;
  me.resources = { wood: 500, stone: 200, ore: 200, food: 300 };
  w.kingdom!.nextPolicyAt = Infinity;
  w.kingdom!.aiNextPolicyAt = Infinity;
  return w;
}

describe('擴張版圖', () => {
  it('第一章打贏才能擴張；地圖變大，舊地圖原封不動', () => {
    const fresh = createKingdomWorld({ player: 'human', enemy: 'orc', difficulty: 'normal', seed: 5, fog: false });
    expect(canExpand(fresh)).toBe(false);
    const w = wonChapterOne();
    expect(kingdomOutcome(w)).toBe('won');
    const oldW = w.width;
    const before = w.tiles.slice(0, oldW).map((t) => t.kind).join();
    expect(canExpand(w)).toBe(true);
    const founded = expandKingdom(w);
    expect(w.width).toBe(EXPANDED_W);
    expect(w.height).toBe(EXPANDED_H);
    expect(w.tiles.slice(0, oldW).map((t) => t.kind).join()).toBe(before);
    expect(founded).toHaveLength(2);
    expect(w.over).toBe(false);
    expect(w.kingdom!.chapter).toBe(2);
    expect(w.kingdom!.rivals).toEqual(founded.map((f) => f.id));
    expect(canExpand(w)).toBe(false);
    // 新王國和玩家、舊對手的種族都不同，起步就有軍隊
    for (const f of founded) {
      expect(f.race).not.toBe('human');
      expect(f.race).not.toBe('orc');
      expect(hqOf(w, f)).toBeDefined();
      expect(factionUnits(w, f.id).filter((u) => u.role === 'warrior').length).toBeGreaterThanOrEqual(5);
    }
  });

  it('擴張後有一片海，三個王國都能在海邊蓋碼頭', () => {
    const w = wonChapterOne();
    expect(hasSea(w)).toBe(false); // 第一章的河流太小，不能行船
    const founded = expandKingdom(w);
    expect(hasSea(w)).toBe(true);
    for (const f of [w.factions[0], ...founded]) expect(findDockSpot(w, f)).not.toBeNull();
  });

  it('打掉一個新王國還沒結束，兩個都打掉才統一天下', () => {
    const w = wonChapterOne();
    const [a, b] = expandKingdom(w);
    damageBuilding(w, hqOf(w, a)!, 99999, 0);
    step(w);
    expect(w.over).toBe(false);
    damageBuilding(w, hqOf(w, b)!, 99999, 0);
    step(w);
    expect(w.over).toBe(true);
    expect(kingdomOutcome(w)).toBe('won');
  });

  it('擴張後新王國休養生息，一開始不會出兵', () => {
    const w = wonChapterOne();
    const founded = expandKingdom(w);
    for (let i = 0; i < 600; i++) step(w);
    for (const f of founded) expect(f.stance === 'attack' && !w.factions[f.targetFaction!].neutral).toBe(false);
  });
});

describe('海軍', () => {
  it('碼頭蓋在海邊；船在碼頭旁的海面下水，只能走海路', () => {
    const w = wonChapterOne();
    expandKingdom(w);
    const me = w.factions[0];
    me.tech = 2;
    me.resources = { wood: 500, stone: 200, ore: 200, food: 300 };
    const dock = placeBuilding(w, me, 'dock')!;
    const woodAfterDock = me.resources.wood;
    expect(dock).not.toBeNull();
    const ring = [];
    for (let y = dock.y - 1; y <= dock.y + 2; y++) for (let x = dock.x - 1; x <= dock.x + 2; x++) ring.push(isSea(w, x, y));
    expect(ring.some(Boolean)).toBe(true);
    // 碼頭沒完工不能造船
    expect(trainShip(w, me, 'transport')).toBeNull();
    dock.complete = true;
    const ship = trainShip(w, me, 'transport')!;
    expect(ship).not.toBeNull();
    expect(isSea(w, Math.floor(ship.x), Math.floor(ship.y))).toBe(true);
    expect(me.resources.wood).toBe(woodAfterDock - 70);
    const path = findPath(w, Math.floor(ship.x), Math.floor(ship.y), 80, 50, w.width * w.height, false, true)!;
    expect(path).not.toBeNull();
    expect(path.every((p) => isSea(w, p.x, p.y))).toBe(true);
  });

  it('登陸作戰：戰士上船、渡海、在敵方海岸上岸', () => {
    const w = expandedWithDock();
    const me = w.factions[0];
    const [east] = w.kingdom!.rivals.map((id) => w.factions[id]);
    w.kingdom!.peaceUntil = 0;
    // 別讓路過的敵軍把船打沉：其他陣營只留工人
    w.units = w.units.filter((u) => u.factionId === me.id || u.role !== 'warrior');
    w.unitMap = new Map(w.units.map((u) => [u.id, u]));
    const ship = trainShip(w, me, 'transport')!;
    const dock = docksOf(w, me.id)[0];
    // 碼頭邊放 4 名戰士，其他戰士都送去駐守，免得被點名
    for (const u of factionUnits(w, me.id)) if (u.role === 'warrior') u.post = -1;
    for (let i = 0; i < 4; i++) spawnUnit(w, me, 'warrior', 'soldier', { x: dock.x + 1, y: dock.y + 1 });
    issueCommand(w, me.id, { type: 'setStance', stance: 'attack', target: east.id });
    let boarded = false;
    let landed = false;
    for (let i = 0; i < 4000 && !landed; i++) {
      step(w);
      if (w.units.some((u) => u.aboard === ship.id)) boarded = true;
      if (me.landing?.phase === 'return') landed = true;
    }
    expect(boarded).toBe(true);
    expect(landed).toBe(true);
    const ehq = hqOf(w, east)!;
    const lander = factionUnits(w, me.id).find((u) => u.role === 'warrior' && u.post === undefined && dist(u.x, u.y, ehq.x, ehq.y) < 25);
    expect(lander).toBeDefined();
    expect(isSea(w, Math.floor(lander!.x), Math.floor(lander!.y))).toBe(false);
  });

  it('運兵船沉了，船上的人一起淹死', () => {
    const w = expandedWithDock();
    const me = w.factions[0];
    const ship = trainShip(w, me, 'transport')!;
    const sailors = [0, 1, 2].map(() => spawnUnit(w, me, 'warrior', 'soldier', { x: ship.x, y: ship.y })!);
    for (const u of sailors) u.aboard = ship.id;
    ship.hp = 0;
    updateNaval(w);
    expect(sailors.every((u) => u.hp <= 0)).toBe(true);
  });

  it('近戰的小兵不會去追海上的船，弓手可以射', () => {
    const w = expandedWithDock();
    const me = w.factions[0];
    const ship = trainShip(w, me, 'warship')!;
    const foe = w.factions[w.kingdom!.rivals[0]];
    const shore = spawnUnit(w, foe, 'warrior', 'soldier', { x: ship.x + 4, y: ship.y })!;
    expect(canEngage(shore, ship, false)).toBe(false);
    expect(canEngage(shore, ship, true)).toBe(true);
  });
});
