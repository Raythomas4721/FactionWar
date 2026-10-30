import { dist } from '../math';
import { RACES } from '../races';
import { carryOf, gatherRateOf } from '../stats';
import type { Point, ResourceKind, Tile, TileKind, Unit, World } from '../types';
import { areHostile, centerOf, hqOf, sickMult } from '../util';
import { moveTo } from './movement';
import { hasRelic, inLairDanger } from './neutral';
import { eventMult } from '../events';
import { modOf } from '../modifiers';
import { BERRY_MAX, FISH_MAX } from '../map';
import { isPassable } from '../util';

export const RESOURCE_TILE: Record<ResourceKind, TileKind> = {
  wood: 'forest', stone: 'rock', ore: 'ore', food: 'berries',
};

/** 漿果叢與魚群採完會慢慢長回來（約 6 分鐘長滿） */
const BERRY_REGROW = 0.01;
const FISH_REGROW = 0.005;
/** 釣魚比摘漿果慢 */
const FISHING_MULT = 0.7;
/** 漿果與魚群至少要有這麼多才值得跑一趟 */
const REGROW_MIN = 2;
/** 漿果長到這麼多才看得到果子 */
const BERRY_VISIBLE = 8;

/** 這一格能不能採這種資源（糧食可以摘漿果，也可以在岸邊釣魚） */
export function isResourceTile(kind: ResourceKind, t: Tile): boolean {
  return t.kind === RESOURCE_TILE[kind] || (kind === 'food' && t.kind === 'water');
}

/** 站在哪裡釣這格水域的魚：離小人最近、相鄰的陸地 */
function shoreOf(world: World, u: Unit, tx: number, ty: number): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = tx + dx;
    const y = ty + dy;
    if (!isPassable(world, x, y)) continue;
    const d = dist(u.x, u.y, x + 0.5, y + 0.5);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** 漿果與魚群慢慢長回來 */
export function updateRegrowth(world: World): void {
  if (world.tick % 10) return;
  const rich = world.rules.resourceRichness;
  let changed = false;
  for (const i of tilesOfKind(world, 'berries')) {
    const t = world.tiles[i];
    const before = t.amount;
    t.amount = Math.min(BERRY_MAX * rich, t.amount + BERRY_REGROW * 10);
    if (before < BERRY_VISIBLE !== t.amount < BERRY_VISIBLE) changed = true;
  }
  for (const i of tilesOfKind(world, 'water')) {
    const t = world.tiles[i];
    t.amount = Math.min(FISH_MAX * rich, t.amount + FISH_REGROW * 10);
  }
  if (changed) world.terrainVersion++;
}

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
  const kinds = kind === 'food' ? (['berries', 'water'] as const) : [RESOURCE_TILE[kind]];
  const enemyHqs = world.factions
    .filter((f) => f.alive && areHostile(world, u.factionId, f.id))
    .map((f) => hqOf(world, f))
    .filter((b) => !!b)
    .map((b) => centerOf(b!));
  let best: Point | null = null;
  let bestD2 = Infinity;
  const mirrored = !!world.factions[u.factionId]?.mirrored;
  for (const tileKind of kinds) {
    const list = tilesOfKind(world, tileKind);
    // 右邊的陣營倒著找，距離相同時才會挑到和左邊對稱的那一格
    for (let j = 0; j < list.length; j++) {
      const i = list[mirrored ? list.length - 1 - j : j];
      const t = world.tiles[i];
      // 漿果與魚只剩一點點就先別去了，等長回來再說
      if (t.kind !== tileKind || t.amount < (kind === 'food' ? REGROW_MIN : 0.01)) continue;
      const cx = (i % world.width) + 0.5;
      const cy = Math.floor(i / world.width) + 0.5;
      const d2 = (u.x - cx) ** 2 + (u.y - cy) ** 2;
      if (d2 >= bestD2) continue;
      if (tileKind === 'water' && !shoreOf(world, u, cx - 0.5, cy - 0.5)) continue;
      if (enemyHqs.some((c) => dist(c.x, c.y, cx, cy) < ENEMY_HQ_AVOID)) continue;
      if (inLairDanger(world, cx, cy)) continue;
      bestD2 = d2;
      best = { x: cx - 0.5, y: cy - 0.5 };
    }
  }
  return best;
}

/** 走到資源格採集，背包滿了改成「送回」。回傳 false 代表需要重新決策。 */
export function gatherTick(world: World, u: Unit, kind: ResourceKind, tx: number, ty: number): boolean {
  const tile = world.tiles[ty * world.width + tx];
  if (!isResourceTile(kind, tile) || tile.amount <= 0.01) return false;
  const fishing = tile.kind === 'water';
  if (fishing) {
    const shore = shoreOf(world, u, tx, ty);
    if (!shore) return false;
    if (!moveTo(world, u, shore.x + 0.5, shore.y + 0.5, 0.45)) return true;
  } else if (!moveTo(world, u, tx + 0.5, ty + 0.5, 0.6)) return true;

  const cap = carryOf(u.attrs);
  if (!u.carrying || u.carrying.kind !== kind) u.carrying = { kind, amount: 0 };
  const rate =
    gatherRateOf(u.attrs, kind === 'food') * (kind === 'food' ? RACES[u.race].forageMult : 1) * world.rules.gatherMult * sickMult(u) *
    (hasRelic(world, u.factionId, 'harvest') ? 1.4 : 1) *
    eventMult(world, kind === 'food' ? 'forage' : 'gather') *
    modOf(world, u.factionId, 'gather') * (kind === 'food' ? modOf(world, u.factionId, 'food') : 1) *
    (fishing ? FISHING_MULT : 1);
  const amt = Math.min(rate, tile.amount, cap - u.carrying.amount);
  u.carrying.amount += amt;
  tile.amount -= amt;
  if (tile.kind === 'berries') {
    // 漿果叢不會消失，只是一時沒有果子
    if (tile.amount < BERRY_VISIBLE && tile.amount + amt >= BERRY_VISIBLE) world.terrainVersion++;
    if (tile.amount <= 0.001) tile.amount = 0;
  } else if (fishing) {
    if (tile.amount < 0.001) tile.amount = 0;
  } else if (tile.amount <= 0.001) {
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
