import type { Rng } from './rng';
import type { Point, Tile, TileKind } from './types';

/**
 * 地圖產生：先隨機產生左上象限，再鏡射到四個象限。
 * 四個陣營拿到完全對稱的地形，勝負只取決於種族差異。
 */

export interface MapResult {
  tiles: Tile[];
  /** 四個營帳的左上角（2x2） */
  hqSpots: Point[];
}

const AMOUNTS: Record<TileKind, number> = {
  grass: 0, water: 0, forest: 50, rock: 100, ore: 70, berries: 35,
};

const HQ_LOCAL: Point = { x: 5, y: 5 };
const BASE_CLEAR_RADIUS = 4.5;

export function generateMap(rng: Rng, w: number, h: number): MapResult {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = tryGenerate(rng, w, h);
    if (isConnected(result, w, h)) return result;
  }
  throw new Error('無法產生連通的地圖');
}

function tryGenerate(rng: Rng, w: number, h: number): MapResult {
  const qw = Math.floor(w / 2);
  const qh = Math.floor(h / 2);
  const q: { kind: TileKind; amount: number }[] = Array.from({ length: qw * qh }, () => ({ kind: 'grass', amount: 0 }));
  const hqCx = HQ_LOCAL.x + 1;
  const hqCy = HQ_LOCAL.y + 1;

  const canPlace = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < qw && y < qh &&
    q[y * qw + x].kind === 'grass' &&
    Math.hypot(x + 0.5 - hqCx, y + 0.5 - hqCy) > BASE_CLEAR_RADIUS;

  const blob = (cx: number, cy: number, n: number, kind: TileKind, amount = AMOUNTS[kind]) => {
    const cells: Point[] = [];
    if (canPlace(cx, cy)) {
      q[cy * qw + cx] = { kind, amount };
      cells.push({ x: cx, y: cy });
    }
    for (let tries = 0; cells.length < n && tries < n * 12; tries++) {
      const from = cells.length ? rng.pick(cells) : { x: cx, y: cy };
      const dir = rng.int(0, 3);
      const nx = from.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      const ny = from.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (canPlace(nx, ny)) {
        q[ny * qw + nx] = { kind, amount };
        cells.push({ x: nx, y: ny });
      }
    }
  };

  // 每個基地旁固定的資源
  blob(11, 7, 6, 'berries');
  blob(7, 11, 6, 'berries');
  blob(14, 3, 14, 'forest');
  blob(3, 14, 14, 'forest');
  blob(12, 12, 8, 'rock');
  blob(16, 9, 7, 'ore');
  // 隨機地形
  blob(rng.int(18, 26), rng.int(5, 15), rng.int(8, 14), 'water');
  blob(rng.int(16, 26), rng.int(14, 21), 18, 'forest');
  blob(rng.int(20, 28), rng.int(2, 8), 12, 'forest');
  blob(rng.int(22, 27), rng.int(17, 21), 6, 'rock');
  // 地圖中央的富礦，四方爭奪
  blob(qw - 2, qh - 2, 8, 'ore', 140);

  const tiles: Tile[] = Array.from({ length: w * h }, () => ({ kind: 'grass', amount: 0 }));
  for (let y = 0; y < qh; y++) {
    for (let x = 0; x < qw; x++) {
      const src = q[y * qw + x];
      for (const [mx, my] of [[x, y], [w - 1 - x, y], [x, h - 1 - y], [w - 1 - x, h - 1 - y]]) {
        tiles[my * w + mx] = { kind: src.kind, amount: src.amount };
      }
    }
  }

  const hqSpots: Point[] = [
    { x: HQ_LOCAL.x, y: HQ_LOCAL.y },
    { x: w - 1 - (HQ_LOCAL.x + 1), y: HQ_LOCAL.y },
    { x: HQ_LOCAL.x, y: h - 1 - (HQ_LOCAL.y + 1) },
    { x: w - 1 - (HQ_LOCAL.x + 1), y: h - 1 - (HQ_LOCAL.y + 1) },
  ];
  return { tiles, hqSpots };
}

function isConnected(map: MapResult, w: number, h: number): boolean {
  const seen = new Uint8Array(w * h);
  const start = map.hqSpots[0];
  const queue = [start.y * w + start.x];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || map.tiles[ni].kind === 'water') continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return map.hqSpots.every((p) => seen[p.y * w + p.x] === 1);
}
