import { dist } from '../math';
import {
  CAPTURE_RADIUS, CAPTURE_TICKS, OUTPOST_DEFS, WATCHTOWER_COOLDOWN, WATCHTOWER_DAMAGE, WATCHTOWER_RANGE,
} from '../outposts';
import type { Faction, Outpost, OutpostKind, Point, Resources, Unit, World } from '../types';
import { areHostile, centerOf, hqOf, isTargetable, logEvent } from '../util';
import { damageUnit } from './combat';

export function createOutposts(world: World, spots: { kind: OutpostKind; x: number; y: number }[]): void {
  world.outposts = spots.map((s) => ({
    id: world.nextId++, kind: s.kind, x: s.x, y: s.y, owner: null, capturing: null, progress: 0, cooldown: 0,
  }));
}

/** 算不算佔領兵力：戰士與英雄（斥候、怪物、召喚物、地底工兵不算） */
function canCapture(world: World, u: Unit): boolean {
  return (
    u.hp > 0 && u.role === 'warrior' && u.troop !== 'scout' && !u.monster && u.summonedBy === undefined &&
    !u.underground && !world.factions[u.factionId].neutral
  );
}

export function outpostLabel(o: Outpost): string {
  return `${OUTPOST_DEFS[o.kind].icon}${OUTPOST_DEFS[o.kind].name}`;
}

/** 每個 tick：佔領進度、礦場收入、瞭望塔射擊 */
export function updateOutposts(world: World): void {
  for (const o of world.outposts) {
    capture(world, o);
    if (o.owner === null || !world.factions[o.owner].alive) {
      if (o.owner !== null) o.owner = null;
      continue;
    }
    const owner = world.factions[o.owner];
    const income = OUTPOST_DEFS[o.kind].income;
    if (income) for (const k of Object.keys(income) as (keyof Resources)[]) owner.resources[k] += income[k] ?? 0;
    if (o.kind === 'watchtower') watchtowerShoot(world, o, owner);
  }
}

function capture(world: World, o: Outpost): void {
  const present = new Map<number, number>();
  for (const u of world.units) {
    if (!canCapture(world, u) || dist(u.x, u.y, o.x, o.y) > CAPTURE_RADIUS) continue;
    present.set(u.factionId, (present.get(u.factionId) ?? 0) + 1);
  }
  // 沒人在：進度慢慢消退；兩方都在：僵持
  if (present.size === 0) {
    o.progress = Math.max(0, o.progress - 1 / (CAPTURE_TICKS * 2));
    if (o.progress === 0) o.capturing = null;
    return;
  }
  if (present.size > 1) return;
  const [[fid, n]] = [...present];
  if (fid === o.owner) {
    o.capturing = null;
    o.progress = 0;
    return;
  }
  if (o.capturing !== fid) {
    o.capturing = fid;
    o.progress = 0;
  }
  const rate = Math.min(3, n) / CAPTURE_TICKS / (o.owner === null ? 1 : 2);
  o.progress += rate;
  if (o.progress < 1) return;
  const f = world.factions[fid];
  const prev = o.owner === null ? null : world.factions[o.owner];
  o.owner = fid;
  o.capturing = null;
  o.progress = 0;
  logEvent(world, 'faction', prev ? `🚩 ${f.name} 從 ${prev.name} 手中奪下了${outpostLabel(o)}！` : `🚩 ${f.name} 佔領了${outpostLabel(o)}`, fid);
}

function watchtowerShoot(world: World, o: Outpost, owner: Faction): void {
  if (o.cooldown > 0) {
    o.cooldown--;
    return;
  }
  let target: Unit | null = null;
  let best = WATCHTOWER_RANGE;
  for (const e of world.units) {
    if (!isTargetable(e, o.x, o.y) || !areHostile(world, owner.id, e.factionId)) continue;
    const d = dist(o.x, o.y, e.x, e.y);
    if (d <= best) {
      best = d;
      target = e;
    }
  }
  if (!target) return;
  o.cooldown = WATCHTOWER_COOLDOWN;
  world.effects.push({ x1: o.x, y1: o.y, x2: target.x, y2: target.y, ttl: 3, maxTtl: 3, color: owner.color });
  damageUnit(world, target, WATCHTOWER_DAMAGE * world.rules.damageMult, owner.id, `${owner.name}的瞭望塔`);
}

/** 駐守的站位：圍著據點排開，每個人位置固定 */
export function garrisonSpot(o: Outpost, u: Unit): Point {
  const angle = (u.id * 2.39996) % (Math.PI * 2);
  return { x: o.x + Math.cos(angle) * 1.2, y: o.y + Math.sin(angle) * 1.2 };
}

/** 可以被派去駐守的戰士 */
function assignable(u: Unit): boolean {
  return (
    u.hp > 0 && u.role === 'warrior' && u.troop !== 'scout' && !u.hero && !u.monster &&
    u.summonedBy === undefined && u.followHero === undefined
  );
}

/** 依陣營想要的駐守人數，派出或召回戰士 */
export function assignGarrisons(world: World, f: Faction): void {
  const mine = world.units.filter((u) => u.factionId === f.id && u.hp > 0);
  for (const u of mine) {
    if (u.post !== undefined && !world.outposts.some((o) => o.id === u.post)) u.post = undefined;
  }
  for (const o of world.outposts) {
    const want = f.garrisons[o.id] ?? 0;
    const have = mine.filter((u) => u.post === o.id);
    for (const u of have.slice(want)) u.post = undefined;
    if (have.length >= want) continue;
    const free = mine
      .filter((u) => u.post === undefined && assignable(u))
      .sort((a, b) => dist(a.x, a.y, o.x, o.y) - dist(b.x, b.y, o.x, o.y));
    for (const u of free.slice(0, want - have.length)) u.post = o.id;
  }
}

export function garrisonOf(world: World, factionId: number, outpostId: number): Unit[] {
  return world.units.filter((u) => u.hp > 0 && u.factionId === factionId && u.post === outpostId);
}

export const MAX_GARRISON = 6;

/** 玩家增減某個據點的駐守人數 */
export function adjustGarrison(world: World, f: Faction, outpostId: number, delta: number): void {
  f.garrisons[outpostId] = Math.max(0, Math.min(MAX_GARRISON, (f.garrisons[outpostId] ?? 0) + delta));
  assignGarrisons(world, f);
}

/**
 * AI 的據點策略：兵力每 4 人守一個據點，從離家近的開始；
 * 被敵人佔走的據點多派一點人去搶。
 */
export function decideOutposts(world: World, f: Faction, warriorCount: number): void {
  if (!world.outposts.length) return;
  const hq = hqOf(world, f);
  if (!hq) return;
  const c = centerOf(hq);
  const budget = Math.min(world.outposts.length, Math.floor(warriorCount / 4));
  const sorted = [...world.outposts].sort((a, b) => dist(c.x, c.y, a.x, a.y) - dist(c.x, c.y, b.x, b.y));
  f.garrisons = {};
  for (const o of sorted.slice(0, budget)) f.garrisons[o.id] = o.owner !== null && o.owner !== f.id ? 3 : 2;
}

export function outpostsOwned(world: World, factionId: number): number {
  return world.outposts.filter((o) => o.owner === factionId).length;
}
