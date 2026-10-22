import { dist } from '../math';
import { RACES } from '../races';
import { carryOf, gatherRateOf } from '../stats';
import type { Point, ResourceKind, TileKind, Unit, World } from '../types';
import { areHostile, centerOf, hqOf, sickMult } from '../util';
import { moveTo } from './movement';

export const RESOURCE_TILE: Record<ResourceKind, TileKind> = {
  wood: 'forest', stone: 'rock', ore: 'ore', food: 'berries',
};

/** 不去敵方營帳附近採集 */
const ENEMY_HQ_AVOID = 9;

export function findNearestResource(world: World, u: Unit, kind: ResourceKind): Point | null {
  const tileKind = RESOURCE_TILE[kind];
  const enemyHqs = world.factions
    .filter((f) => f.alive && areHostile(world, u.factionId, f.id))
    .map((f) => hqOf(world, f))
    .filter((b) => !!b)
    .map((b) => centerOf(b!));
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const t = world.tiles[y * world.width + x];
      if (t.kind !== tileKind || t.amount <= 0) continue;
      const d = dist(u.x, u.y, x + 0.5, y + 0.5);
      if (d >= bestD) continue;
      if (enemyHqs.some((c) => dist(c.x, c.y, x + 0.5, y + 0.5) < ENEMY_HQ_AVOID)) continue;
      bestD = d;
      best = { x, y };
    }
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
    gatherRateOf(u.attrs, kind === 'food') * (kind === 'food' ? RACES[u.race].forageMult : 1) * world.rules.gatherMult * sickMult(u);
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
