import { dist } from '../math';
import { RACES } from '../races';
import { carryOf, gatherRateOf } from '../stats';
import type { Point, ResourceKind, TileKind, Unit, World } from '../types';
import { areHostile, centerOf, hqOf, sickMult } from '../util';
import { moveTo } from './movement';
import { hasRelic, inLairDanger } from './neutral';
import { eventMult } from '../events';
import { modOf } from '../modifiers';

export const RESOURCE_TILE: Record<ResourceKind, TileKind> = {
  wood: 'forest', stone: 'rock', ore: 'ore', food: 'berries',
};

/** 不去敵方營帳附近採集 */
const ENEMY_HQ_AVOID = 9;

// 各種地形格子的索引快取；地形改變（資源採完、造林）時才重建
let cachedWorld: World | null = null;
let cachedVersion = -1;
let tilesByKind = new Map<TileKind, number[]>();

function tilesOfKind(world: World, kind: TileKind): number[] {
  if (cachedWorld !== world || cachedVersion !== world.terrainVersion) {
    tilesByKind = new Map();
    world.tiles.forEach((t, i) => {
      const list = tilesByKind.get(t.kind);
      if (list) list.push(i);
      else tilesByKind.set(t.kind, [i]);
    });
    cachedWorld = world;
    cachedVersion = world.terrainVersion;
  }
  return tilesByKind.get(kind) ?? [];
}

export function findNearestResource(world: World, u: Unit, kind: ResourceKind): Point | null {
  const tileKind = RESOURCE_TILE[kind];
  const enemyHqs = world.factions
    .filter((f) => f.alive && areHostile(world, u.factionId, f.id))
    .map((f) => hqOf(world, f))
    .filter((b) => !!b)
    .map((b) => centerOf(b!));
  let best: Point | null = null;
  let bestD2 = Infinity;
  for (const i of tilesOfKind(world, tileKind)) {
    const t = world.tiles[i];
    if (t.kind !== tileKind || t.amount <= 0) continue;
    const cx = (i % world.width) + 0.5;
    const cy = Math.floor(i / world.width) + 0.5;
    const d2 = (u.x - cx) ** 2 + (u.y - cy) ** 2;
    if (d2 >= bestD2) continue;
    if (enemyHqs.some((c) => dist(c.x, c.y, cx, cy) < ENEMY_HQ_AVOID)) continue;
    if (inLairDanger(world, cx, cy)) continue;
    bestD2 = d2;
    best = { x: cx - 0.5, y: cy - 0.5 };
  }
  return best;
}

/** 走到資源格採集，背包滿了改成「送回」。回傳 false 代表需要重新決策。 */
export function gatherTick(world: World, u: Unit, kind: ResourceKind, tx: number, ty: number): boolean {
  const tile = world.tiles[ty * world.width + tx];
  if (tile.kind !== RESOURCE_TILE[kind] || tile.amount <= 0) return false;
  if (!moveTo(world, u, tx + 0.5, ty + 0.5, 0.6)) return true;

  const cap = carryOf(u.attrs);
  if (!u.carrying || u.carrying.kind !== kind) u.carrying = { kind, amount: 0 };
  const rate =
    gatherRateOf(u.attrs, kind === 'food') * (kind === 'food' ? RACES[u.race].forageMult : 1) * world.rules.gatherMult * sickMult(u) *
    (hasRelic(world, u.factionId, 'harvest') ? 1.4 : 1) *
    eventMult(world, kind === 'food' ? 'forage' : 'gather') *
    modOf(world, u.factionId, 'gather') * (kind === 'food' ? modOf(world, u.factionId, 'food') : 1);
  const amt = Math.min(rate, tile.amount, cap - u.carrying.amount);
  u.carrying.amount += amt;
  tile.amount -= amt;
  if (tile.amount <= 0.001) {
    tile.kind = 'grass';
    tile.amount = 0;
    world.terrainVersion++;
  }
  if (u.carrying.amount >= cap - 0.001) {
    u.action = { type: 'deliver' };
    u.path.length = 0;
  }
  return true;
}

export function deliverTick(world: World, u: Unit): boolean {
  const f = world.factions[u.factionId];
  const hq = hqOf(world, f);
  if (!hq) return false;
  const c = centerOf(hq);
  if (!moveTo(world, u, c.x, c.y, 1.6)) return true;
  if (u.carrying) f.resources[u.carrying.kind] += u.carrying.amount;
  u.carrying = null;
  return false;
}
