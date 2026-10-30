import { dist } from '../math';
import { speedOf } from '../stats';
import { TROOP_DEFS } from '../troops';
import type { Point, Unit, World } from '../types';
import { isPassable as isLandPassable } from '../util';
import { modOf } from '../modifiers';
import { isNaval, isSea, nearestSeaTile } from '../sea';

/** 船隻的速度（格／tick） */
const SHIP_SPEED = 0.13;
/** 走古地道的代價：相當於在地面走這麼多格 */
export const TUNNEL_COST = 14;

/** 古地道入口格 → 另一端的格子索引 */
function portalsOf(world: World): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of world.tunnels) {
    const a = t.a.y * world.width + t.a.x;
    const b = t.b.y * world.width + t.b.x;
    m.set(a, b);
    m.set(b, a);
  }
  return m;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;
/** 旋轉 180° 的方向順序：1v1 地圖右邊的陣營用這組，同分路線才會選到和左邊對稱的那條 */
const DIRS_MIRRORED = DIRS.map(([dx, dy, c]) => [-dx, -dy, c] as const);

// A* 用的暫存陣列，以「戳記」區分不同次搜尋，避免每次重新配置
let bufSize = 0;
let gScore = new Float64Array(0);
let cameFrom = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let curStamp = 0;

function ensureBuffers(n: number) {
  if (bufSize === n) return;
  bufSize = n;
  gScore = new Float64Array(n);
  cameFrom = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  curStamp = 0;
}

/**
 * 8 方向 A*，避開水域，不允許斜穿水域角落；古地道的兩端互通。
 * naval = 船隻：反過來只能走海面，也不走地道。
 * 回傳不含起點的格子路徑（走地道時，入口後面緊接著出口）；找不到則回傳 null。
 */
export function findPath(
  world: World, sx: number, sy: number, gx: number, gy: number, maxExpand = 5000, mirrored = false, naval = false,
): Point[] | null {
  const w = world.width;
  const isPassable = naval ? isSea : isLandPassable;
  if (!isPassable(world, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  ensureBuffers(w * world.height);
  curStamp++;

  const heapIdx: number[] = [];
  const heapF: number[] = [];
  const push = (idx: number, f: number) => {
    heapIdx.push(idx);
    heapF.push(f);
    let i = heapIdx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapIdx[p], heapIdx[i]] = [heapIdx[i], heapIdx[p]];
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heapIdx[0];
    const lastI = heapIdx.pop()!;
    const lastF = heapF.pop()!;
    if (heapIdx.length) {
      heapIdx[0] = lastI;
      heapF[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heapIdx.length && heapF[l] < heapF[m]) m = l;
        if (r < heapIdx.length && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        [heapIdx[m], heapIdx[i]] = [heapIdx[i], heapIdx[m]];
        [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
        i = m;
      }
    }
    return top;
  };
  const octile = (x: number, y: number, tx: number, ty: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  // 有地道時，估計值也要考慮「先走到入口、從出口出來」，才不會漏掉捷徑
  const portals = world.tunnels.length && !naval ? portalsOf(world) : null;
  const h = (x: number, y: number) => {
    let best = octile(x, y, gx, gy);
    for (const t of portals ? world.tunnels : []) {
      best = Math.min(
        best,
        octile(x, y, t.a.x, t.a.y) + TUNNEL_COST + octile(t.b.x, t.b.y, gx, gy),
        octile(x, y, t.b.x, t.b.y) + TUNNEL_COST + octile(t.a.x, t.a.y, gx, gy),
      );
    }
    return best;
  };

  const start = sy * w + sx;
  const goal = gy * w + gx;
  stamp[start] = curStamp;
  gScore[start] = 0;
  cameFrom[start] = -1;
  push(start, h(sx, sy));

  let expanded = 0;
  while (heapIdx.length && expanded < maxExpand) {
    const cur = pop();
    if (closed[cur] === curStamp) continue;
    closed[cur] = curStamp;
    expanded++;
    if (cur === goal) {
      const path: Point[] = [];
      for (let i = goal; i !== start; i = cameFrom[i]) path.push({ x: i % w, y: Math.floor(i / w) });
      return path.reverse();
    }
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy, cost] of mirrored ? DIRS_MIRRORED : DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isPassable(world, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isPassable(world, cx + dx, cy) || !isPassable(world, cx, cy + dy))) continue;
      const ni = ny * w + nx;
      if (closed[ni] === curStamp) continue;
      const g = gScore[cur] + cost;
      if (stamp[ni] === curStamp && g >= gScore[ni]) continue;
      stamp[ni] = curStamp;
      gScore[ni] = g;
      cameFrom[ni] = cur;
      push(ni, g + h(nx, ny));
    }
    const exit = portals?.get(cur);
    if (exit !== undefined && closed[exit] !== curStamp) {
      const g = gScore[cur] + TUNNEL_COST;
      if (stamp[exit] !== curStamp || g < gScore[exit]) {
        stamp[exit] = curStamp;
        gScore[exit] = g;
        cameFrom[exit] = cur;
        push(exit, g + h(exit % w, Math.floor(exit / w)));
      }
    }
  }
  return null;
}

/**
 * 朝 (cx, cy) 移動，進入 stopDist 範圍內回傳 true。
 * 目標移動超過一格才重新尋路，並限制重新尋路的頻率。
 */
export function moveTo(world: World, u: Unit, cx: number, cy: number, stopDist: number): boolean {
  if (dist(u.x, u.y, cx, cy) <= stopDist) {
    u.path.length = 0;
    return true;
  }
  const naval = isNaval(u);
  const isPassable = naval ? isSea : isLandPassable;
  const gx = Math.floor(cx);
  const gy = Math.floor(cy);
  const goalMoved = !u.pathGoal || Math.abs(u.pathGoal.x - gx) + Math.abs(u.pathGoal.y - gy) > 1;
  if ((u.path.length === 0 || goalMoved) && world.tick >= u.repathAt) {
    // 船要去岸上的目標：開到離它最近的海面
    const goal = naval && !isSea(world, gx, gy) ? nearestSeaTile(world, cx, cy, 8) : { x: gx, y: gy };
    const p = goal
      ? findPath(world, Math.floor(u.x), Math.floor(u.y), goal.x, goal.y, world.width * world.height, !!world.factions[u.factionId]?.mirrored, naval)
      : null;
    u.path = p ?? [];
    u.pathGoal = { x: gx, y: gy };
    u.repathAt = world.tick + (p ? 4 : 20);
  }

  let speed = naval
    ? SHIP_SPEED * modOf(world, u.factionId, 'speed')
    : speedOf(u.attrs) * (u.sick ? 0.75 : 1) * TROOP_DEFS[u.troop].speedMult *
      (world.factions[u.factionId]?.relics.includes('swift') ? 1.2 : 1) *
      (u.hero?.talents.includes('swiftness') ? 1.2 : 1) * modOf(world, u.factionId, 'speed');
  const fullSpeed = speed;
  const startX = u.x;
  const startY = u.y;
  while (speed > 0) {
    const node = u.path[0];
    if (node && world.tunnels.length && Math.max(Math.abs(node.x - Math.floor(u.x)), Math.abs(node.y - Math.floor(u.y))) > 1) {
      // 下一格是地道出口：站在入口就鑽進去，被擠開了就先走回入口
      const entrance = portalsOf(world).get(node.y * world.width + node.x);
      if (entrance !== undefined) {
        if (entrance === Math.floor(u.y) * world.width + Math.floor(u.x)) {
          enterTunnel(world, u, node, fullSpeed);
          return false;
        }
        u.path.unshift({ x: entrance % world.width, y: Math.floor(entrance / world.width) });
        continue;
      }
    }
    const tx = node ? node.x + 0.5 : cx;
    const ty = node ? node.y + 0.5 : cy;
    const d = dist(u.x, u.y, tx, ty);
    // 目標在走不到的地方（例如船在海上）：停在岸邊
    if (!node && !isPassable(world, Math.floor(tx), Math.floor(ty)) && d <= speed) break;
    if (d <= speed) {
      u.x = tx;
      u.y = ty;
      speed -= d;
      if (!node) break;
      u.path.shift();
    } else {
      const nx = u.x + ((tx - u.x) / d) * speed;
      const ny = u.y + ((ty - u.y) / d) * speed;
      if (!isPassable(world, Math.floor(nx), Math.floor(ny))) break;
      u.x = nx;
      u.y = ny;
      break;
    }
  }
  // 騎兵奔跑會累積衝鋒距離
  if (u.troop === 'cavalry') u.charge = Math.min(10, u.charge + dist(startX, startY, u.x, u.y));
  return dist(u.x, u.y, cx, cy) <= stopDist;
}

/** 從腳下的地道入口鑽到另一端；穿行時間等於在地面走 TUNNEL_COST 格 */
function enterTunnel(world: World, u: Unit, exit: Point, speed: number): void {
  u.path.shift();
  u.x = exit.x + 0.5;
  u.y = exit.y + 0.5;
  u.underground = true;
  u.surfaceAt = world.tick + Math.ceil(TUNNEL_COST / speed);
  u.charge = 0;
}
