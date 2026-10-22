import { dist } from '../math';
import { speedOf } from '../stats';
import type { Point, Unit, World } from '../types';
import { isPassable } from '../util';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;

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

/** 8 方向 A*，避開水域，不允許斜穿水域角落。回傳不含起點的格子路徑；找不到則回傳 null。 */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number, maxExpand = 5000): Point[] | null {
  const w = world.width;
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
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
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
    for (const [dx, dy, cost] of DIRS) {
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
  const gx = Math.floor(cx);
  const gy = Math.floor(cy);
  const goalMoved = !u.pathGoal || Math.abs(u.pathGoal.x - gx) + Math.abs(u.pathGoal.y - gy) > 1;
  if ((u.path.length === 0 || goalMoved) && world.tick >= u.repathAt) {
    const p = findPath(world, Math.floor(u.x), Math.floor(u.y), gx, gy);
    u.path = p ?? [];
    u.pathGoal = { x: gx, y: gy };
    u.repathAt = world.tick + (p ? 4 : 20);
  }

  let speed = speedOf(u.attrs) * (u.sick ? 0.75 : 1);
  while (speed > 0) {
    const node = u.path[0];
    const tx = node ? node.x + 0.5 : cx;
    const ty = node ? node.y + 0.5 : cy;
    const d = dist(u.x, u.y, tx, ty);
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
  return dist(u.x, u.y, cx, cy) <= stopDist;
}
