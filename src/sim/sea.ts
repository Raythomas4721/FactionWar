import { dist } from './math';
import { TROOP_DEFS } from './troops';
import type { Building, Faction, Point, Unit, World } from './types';
import { centerOf, hqOf, isFreeSpot, isPassable, tileAt } from './util';

/**
 * 海：連在一起、夠大的一片水域。河流與池塘太小，不能行船。
 * 船隻只能在海上航行，碼頭也只能蓋在海邊。
 */

/** 水域至少要這麼多格才算海 */
export const SEA_MIN_TILES = 150;
/** 碼頭最遠蓋在離營帳多遠的地方 */
const DOCK_SEARCH_RADIUS = 30;

let cachedWorld: World | null = null;
let cachedKey = '';
let seaMask = new Uint8Array(0);

/** 每一格是不是海（1 = 海）；地形改變時重算 */
function seaOf(world: World): Uint8Array {
  const key = `${world.width}x${world.height}:${world.terrainVersion}`;
  if (cachedWorld === world && cachedKey === key) return seaMask;
  const w = world.width;
  const n = w * world.height;
  const label = new Int32Array(n).fill(-1);
  const mask = new Uint8Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] >= 0 || world.tiles[i].kind !== 'water') continue;
    const id = next++;
    const cells = [i];
    label[i] = id;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const x = c % w;
      const y = Math.floor(c / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= world.height) continue;
        const ni = ny * w + nx;
        if (label[ni] >= 0 || world.tiles[ni].kind !== 'water') continue;
        label[ni] = id;
        cells.push(ni);
      }
    }
    if (cells.length >= SEA_MIN_TILES) for (const c of cells) mask[c] = 1;
  }
  cachedWorld = world;
  cachedKey = key;
  seaMask = mask;
  return mask;
}

export function isSea(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return seaOf(world)[y * world.width + x] === 1;
}

export function hasSea(world: World): boolean {
  return seaOf(world).includes(1);
}

export function isNaval(u: Unit): boolean {
  return !!TROOP_DEFS[u.troop].naval;
}

/** 離 (x, y) 最近、在 maxR 格內的海面格子 */
export function nearestSeaTile(world: World, x: number, y: number, maxR: number): Point | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best: Point | null = null;
  let bestD = Infinity;
  const r = Math.ceil(maxR);
  for (let ty = cy - r; ty <= cy + r; ty++) {
    for (let tx = cx - r; tx <= cx + r; tx++) {
      if (!isSea(world, tx, ty)) continue;
      const d = dist(x, y, tx + 0.5, ty + 0.5);
      if (d <= maxR && d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  }
  return best;
}

/** 海面格子旁邊、離 (x, y) 最近的陸地（上岸、登船的地方） */
export function shoreBeside(world: World, sea: Point, toward: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sea.x + dx;
    const y = sea.y + dy;
    if (!isPassable(world, x, y)) continue;
    const d = dist(toward.x, toward.y, x + 0.5, y + 0.5);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** 離 (x, y) 最近、旁邊就是陸地的海面（搶灘的地方） */
export function landingSea(world: World, x: number, y: number, maxR: number): { sea: Point; shore: Point } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best: { sea: Point; shore: Point } | null = null;
  let bestD = Infinity;
  const r = Math.ceil(maxR);
  for (let ty = cy - r; ty <= cy + r; ty++) {
    for (let tx = cx - r; tx <= cx + r; tx++) {
      if (!isSea(world, tx, ty)) continue;
      const d = dist(x, y, tx + 0.5, ty + 0.5);
      if (d > maxR || d >= bestD) continue;
      const shore = shoreBeside(world, { x: tx, y: ty }, { x, y });
      if (!shore) continue;
      bestD = d;
      best = { sea: { x: tx, y: ty }, shore };
    }
  }
  return best;
}

/** 碼頭旁邊的海面：船從這裡下水、在這裡等人上船 */
export function dockWater(world: World, b: Building): Point | null {
  const c = centerOf(b);
  return nearestSeaTile(world, c.x, c.y, 3);
}

/** 營帳附近、緊鄰海面的空地（2x2），離營帳越近越好 */
export function findDockSpot(world: World, f: Faction): Point | null {
  const hq = hqOf(world, f);
  if (!hq) return null;
  const hc = centerOf(hq);
  let best: Point | null = null;
  let bestD = Infinity;
  const r = DOCK_SEARCH_RADIUS;
  for (let y = Math.floor(hc.y - r); y <= hc.y + r; y++) {
    for (let x = Math.floor(hc.x - r); x <= hc.x + r; x++) {
      const d = dist(hc.x, hc.y, x + 1, y + 1);
      if (d > r || d >= bestD || !isFreeSpot(world, x, y)) continue;
      let coast = false;
      for (let yy = y - 1; yy <= y + 2 && !coast; yy++) {
        for (let xx = x - 1; xx <= x + 2; xx++) {
          if (isSea(world, xx, yy)) {
            coast = true;
            break;
          }
        }
      }
      if (!coast) continue;
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** 陣營完工的碼頭 */
export function docksOf(world: World, factionId: number): Building[] {
  return world.buildings.filter((b) => b.factionId === factionId && b.type === 'dock' && b.complete && b.hp > 0);
}

/** 這一格是不是陸地上能站的地方（給登陸的部隊找落腳處） */
export function isLand(world: World, x: number, y: number): boolean {
  const t = tileAt(world, x, y);
  return !!t && t.kind !== 'water';
}
