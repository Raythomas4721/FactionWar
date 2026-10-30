import type { Rng } from './rng';
import type { OutpostKind, Point, Tile, TileKind } from './types';

/**
 * 地圖產生：先隨機產生左上象限，再鏡射到四個象限。
 * 四個陣營拿到完全對稱的地形，勝負只取決於種族差異。
 */

export interface MapResult {
  tiles: Tile[];
  /** 四個營帳的左上角（2x2） */
  hqSpots: Point[];
  /** 巢穴的左上角（2x2）；四人地圖每個象限一座 */
  lairSpots: Point[];
  /** 中央巨龍之巢的左上角（2x2） */
  dragonSpot: Point;
  /** 1v1 地圖：巢穴成對擺放（前一半與後一半點對稱），守衛與寶藏種類相同 */
  pairedLairs?: boolean;
  /** 可以佔領的據點（中心座標） */
  outpostSpots?: { kind: OutpostKind; x: number; y: number }[];
  /** 中立古地道兩端的格子 */
  tunnelSpots?: { a: Point; b: Point }[];
}

/** 1v1 對峙地圖的大小 */
export const DUEL_W = 56;
export const DUEL_H = 36;

/** 水域的魚群上限；漿果與魚採完都會慢慢長回來 */
export const FISH_MAX = 20;
export const BERRY_MAX = 35;

const AMOUNTS: Record<TileKind, number> = {
  grass: 0, water: FISH_MAX, forest: 50, rock: 100, ore: 70, berries: BERRY_MAX,
};

const HQ_LOCAL: Point = { x: 5, y: 5 };
/** 象限內巢穴的左上角 */
const LAIR_LOCAL: Point = { x: 24, y: 12 };
const BASE_CLEAR_RADIUS = 4.5;

export function generateMap(rng: Rng, w: number, h: number, richness = 1): MapResult {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = tryGenerate(rng, w, h, richness);
    if (isConnected(result, w, h)) return result;
  }
  throw new Error('無法產生連通的地圖');
}

function tryGenerate(rng: Rng, w: number, h: number, richness: number): MapResult {
  const qw = Math.floor(w / 2);
  const qh = Math.floor(h / 2);
  const q: { kind: TileKind; amount: number }[] = Array.from({ length: qw * qh }, () => ({ kind: 'grass', amount: 0 }));
  const hqCx = HQ_LOCAL.x + 1;
  const hqCy = HQ_LOCAL.y + 1;

  // 巢穴與地圖中央要留空地放建築
  const reserved = [
    { x: LAIR_LOCAL.x + 1, y: LAIR_LOCAL.y + 1, r: 2.2 },
    { x: qw, y: qh, r: 1.6 },
  ];
  const canPlace = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < qw && y < qh &&
    q[y * qw + x].kind === 'grass' &&
    Math.hypot(x + 0.5 - hqCx, y + 0.5 - hqCy) > BASE_CLEAR_RADIUS &&
    reserved.every((r) => Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y) > r.r);

  const blob = (cx: number, cy: number, n: number, kind: TileKind, baseAmount = AMOUNTS[kind]) => {
    const amount = Math.round(baseAmount * richness);
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
  // 地圖中央的富礦，四方爭奪（巨龍守護）
  blob(qw - 2, qh - 2, 8, 'ore', 140);
  // 巢穴周圍的遠古礦脈
  blob(LAIR_LOCAL.x + 1, LAIR_LOCAL.y + 4, 5, 'ore', 220);
  blob(LAIR_LOCAL.x + 4, LAIR_LOCAL.y, 4, 'ore', 220);

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
  const mirror = (p: Point): Point[] => [
    { x: p.x, y: p.y },
    { x: w - 1 - (p.x + 1), y: p.y },
    { x: p.x, y: h - 1 - (p.y + 1) },
    { x: w - 1 - (p.x + 1), y: h - 1 - (p.y + 1) },
  ];
  return { tiles, hqSpots, lairSpots: mirror(LAIR_LOCAL), dragonSpot: { x: qw - 1, y: qh - 1 } };
}

/**
 * 1v1 對峙地圖：先產生左半邊，再以地圖中心做點對稱（旋轉 180°）得到右半邊。
 * 雙方營帳在左右兩端，各有一座巢穴，中央是巨龍之巢。
 * 兩條南北向的河把中場圍起來，只能從淺灘過河；角落有一條雙方都能走的古地道。
 */
export function generateDuelMap(rng: Rng, w = DUEL_W, h = DUEL_H, richness = 1): MapResult {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = tryGenerateDuel(rng, w, h, richness);
    const outposts = result.outpostSpots!.map((o) => ({ x: Math.floor(o.x), y: Math.floor(o.y) }));
    const tunnels = result.tunnelSpots!.flatMap((t) => [t.a, t.b]);
    if (isConnected(result, w, h, [...result.lairSpots, result.dragonSpot, ...outposts, ...tunnels])) return result;
  }
  throw new Error('無法產生連通的地圖');
}

function tryGenerateDuel(rng: Rng, w: number, h: number, richness: number): MapResult {
  const hw = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const half: { kind: TileKind; amount: number }[] = Array.from({ length: hw * h }, () => ({ kind: 'grass', amount: 0 }));
  const hq: Point = { x: 4, y: midY - 1 };
  // 每邊一座巢穴靠在角落：離營帳 19 格以上（怪物追擊範圍外），
  // 據點也都離巢穴與巨龍 11 格以上，駐守的士兵才不會被怪物盯上
  const lairs: Point[] = [{ x: hw - 13, y: 1 }];
  const dragon: Point = { x: hw - 1, y: midY - 1 };
  // 據點：靠近自家的礦場、中場的瞭望塔、上方正中央的戰神祠（旋轉後在下方）
  const outposts: { kind: OutpostKind; x: number; y: number }[] = [
    { kind: 'mine', x: 15.5, y: midY - 0.5 },
    { kind: 'watchtower', x: hw - 8, y: h - 7 },
    { kind: 'shrine', x: hw, y: 3 },
  ];
  // 古地道：左下角通到右上角（旋轉後就是自己），離雙方營帳一樣遠
  const tunnelEnd: Point = { x: 8, y: h - 5 };
  const reserved = [
    ...outposts.map((o) => ({ x: o.x, y: o.y, r: 2 })),
    { x: tunnelEnd.x + 0.5, y: tunnelEnd.y + 0.5, r: 1.6 },
    { x: hq.x + 1, y: hq.y + 1, r: BASE_CLEAR_RADIUS },
    ...lairs.map((l) => ({ x: l.x + 1, y: l.y + 1, r: 2.2 })),
    { x: hw, y: midY, r: 1.8 },
  ];
  const canPlace = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < hw && y < h &&
    half[y * hw + x].kind === 'grass' &&
    reserved.every((r) => Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y) > r.r);

  const blob = (cx: number, cy: number, n: number, kind: TileKind, baseAmount = AMOUNTS[kind]) => {
    const amount = Math.round(baseAmount * richness);
    const cells: Point[] = [];
    if (canPlace(cx, cy)) {
      half[cy * hw + cx] = { kind, amount };
      cells.push({ x: cx, y: cy });
    }
    for (let tries = 0; cells.length < n && tries < n * 12; tries++) {
      const from = cells.length ? rng.pick(cells) : { x: cx, y: cy };
      const dir = rng.int(0, 3);
      const nx = from.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      const ny = from.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (canPlace(nx, ny)) {
        half[ny * hw + nx] = { kind, amount };
        cells.push({ x: nx, y: ny });
      }
    }
  };

  // 河流：寬兩格，微微蜿蜒，留三處淺灘
  const fords = [[5, 8], [midY - 2, midY + 1], [h - 9, h - 7]];
  for (let y = 0; y < h; y++) {
    if (fords.some(([a, b]) => y >= a && y <= b)) continue;
    const x0 = hw - 6 + Math.round(Math.sin(y / 3.5) * 1.2);
    for (const x of [x0, x0 + 1]) {
      if (reserved.every((r) => Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y) > r.r)) half[y * hw + x] = { kind: 'water', amount: FISH_MAX };
    }
  }
  // 家門口的池塘，可以釣魚
  blob(hq.x + 3, hq.y + 6, 5, 'water');
  // 基地旁固定的資源
  blob(hq.x + 6, hq.y - 3, 6, 'berries');
  blob(hq.x + 6, hq.y + 4, 6, 'berries');
  blob(hq.x, hq.y - 8, 14, 'forest');
  blob(hq.x, hq.y + 9, 14, 'forest');
  blob(hq.x + 8, hq.y + 8, 8, 'rock');
  blob(hq.x + 9, hq.y - 7, 7, 'ore');
  // 隨機地形
  blob(rng.int(hw - 14, hw - 4), rng.int(midY + 3, h - 6), 14, 'forest');
  blob(rng.int(hw - 14, hw - 4), rng.int(5, midY - 3), 10, 'forest');
  blob(rng.int(hw - 8, hw - 2), rng.int(0, h - 1), 5, 'rock');
  // 中央富礦（巨龍守護）與巢穴旁的遠古礦脈
  blob(hw - 3, midY - 3, 6, 'ore', 140);
  for (const l of lairs) {
    blob(l.x + 1, l.y < midY ? l.y + 4 : l.y - 3, 5, 'ore', 220);
    blob(l.x + 4, l.y, 4, 'ore', 220);
  }

  // 點對稱：(x, y) ↔ (w-1-x, h-1-y)
  const tiles: Tile[] = Array.from({ length: w * h }, () => ({ kind: 'grass', amount: 0 }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < hw; x++) {
      const src = half[y * hw + x];
      tiles[y * w + x] = { kind: src.kind, amount: src.amount };
      tiles[(h - 1 - y) * w + (w - 1 - x)] = { kind: src.kind, amount: src.amount };
    }
  }
  // 2x2 建築的左上角旋轉後的位置
  const rotate = (p: Point): Point => ({ x: w - 2 - p.x, y: h - 2 - p.y });
  return {
    tiles,
    hqSpots: [hq, rotate(hq)],
    lairSpots: [...lairs, ...lairs.map(rotate)],
    dragonSpot: dragon,
    pairedLairs: true,
    outpostSpots: [...outposts, ...outposts.map((o) => ({ kind: o.kind, x: w - o.x, y: h - o.y }))],
    tunnelSpots: [{ a: tunnelEnd, b: { x: w - 1 - tunnelEnd.x, y: h - 1 - tunnelEnd.y } }],
  };
}

function isConnected(map: MapResult, w: number, h: number, extra: Point[] = []): boolean {
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
  return [...map.hqSpots, ...extra].every((p) => seen[p.y * w + p.x] === 1);
}
