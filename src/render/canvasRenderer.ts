import { BUILDING_DEFS } from '../sim/buildings';
import { BUILDING_SIZE } from '../sim/constants';
import { ITEM_DEFS } from '../sim/items';
import type { TileKind, Unit, World } from '../sim/types';

export const TILE_PX = 12;

export type Selection = { kind: 'unit'; id: number } | { kind: 'building'; id: number };

const TERRAIN: Record<TileKind, string> = {
  grass: '#2c4529',
  water: '#1d3f61',
  forest: '#1b3520',
  rock: '#55595f',
  ore: '#5e4232',
  berries: '#3a5726',
};

const DETAIL: Partial<Record<TileKind, string>> = {
  forest: '#3f7a3a',
  rock: '#8a8f96',
  ore: '#e0904a',
  berries: '#d9465a',
  water: '#2f5d88',
};

const RESOURCE_DOT: Record<string, string> = {
  wood: '#a87a4a', stone: '#b8bcc4', ore: '#e0904a', food: '#e05068',
};

/** 用座標算出固定的雜訊，讓地形細節每次畫都一樣（不動到模擬亂數） */
const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class CanvasRenderer {
  private terrain = document.createElement('canvas');
  private terrainVersion = -1;
  private terrainSeed = -1;

  constructor(private canvas: HTMLCanvasElement) {}

  draw(world: World, selection: Selection | null): void {
    const T = TILE_PX;
    const w = world.width * T;
    const h = world.height * T;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== w * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.terrainVersion !== world.terrainVersion || this.terrainSeed !== world.seed) this.drawTerrain(world);
    ctx.drawImage(this.terrain, 0, 0, w, h);

    // 建築
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of world.buildings) {
      const f = world.factions[b.factionId];
      const x = b.x * T;
      const y = b.y * T;
      const s = BUILDING_SIZE * T;
      ctx.globalAlpha = b.complete ? 1 : 0.45;
      ctx.fillStyle = shade(f.color, -0.45);
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = f.color;
      ctx.lineWidth = b.type === 'hq' ? 2.5 : 1.5;
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.complete ? '#fff' : 'rgba(255,255,255,0.7)';
      ctx.font = `bold ${b.type === 'hq' ? 15 : 13}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
      ctx.fillText(BUILDING_DEFS[b.type].glyph, x + s / 2, y + s / 2 + 1);
      if (!b.complete) bar(ctx, x + 2, y + s - 4, s - 4, b.progress, '#f5d76e');
      else if (b.hp < b.maxHp) bar(ctx, x + 2, y - 3, s - 4, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
      if (selection?.kind === 'building' && selection.id === b.id) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
      }
    }

    // 箭矢軌跡
    for (const e of world.effects) {
      ctx.globalAlpha = e.ttl / 3;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(e.x1 * T, e.y1 * T);
      ctx.lineTo(e.x2 * T, e.y2 * T);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const u of world.units) this.drawUnit(ctx, world, u, selection);
  }

  private drawUnit(ctx: CanvasRenderingContext2D, world: World, u: Unit, selection: Selection | null) {
    const T = TILE_PX;
    const f = world.factions[u.factionId];
    const x = u.x * T;
    const y = u.y * T;
    ctx.globalAlpha = u.action.type === 'retreat' ? 0.6 : 1;
    ctx.fillStyle = f.color;
    ctx.strokeStyle = '#0b0f0b';
    ctx.lineWidth = 1;
    if (u.role === 'warrior') {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (u.weapon) {
        const def = ITEM_DEFS[u.weapon.defId];
        ctx.strokeStyle = def.ranged ? '#ffe9a8' : '#e8e8e8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (def.ranged) {
          ctx.arc(x + 4, y, 3, -Math.PI / 2, Math.PI / 2);
        } else {
          ctx.moveTo(x + 3, y + 3);
          ctx.lineTo(x + 7, y - 4);
        }
        ctx.stroke();
      }
    } else if (u.role === 'smith') {
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (u.carrying && u.carrying.amount > 0) {
      ctx.fillStyle = RESOURCE_DOT[u.carrying.kind];
      ctx.beginPath();
      ctx.arc(x + 3, y - 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (u.hp < u.maxHp) bar(ctx, x - 5, y - 8, 10, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
    if (selection?.kind === 'unit' && selection.id === u.id) {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTerrain(world: World) {
    const T = TILE_PX;
    const dpr = window.devicePixelRatio || 1;
    this.terrain.width = world.width * T * dpr;
    this.terrain.height = world.height * T * dpr;
    const ctx = this.terrain.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const t = world.tiles[y * world.width + x];
        const n = hash(x, y);
        ctx.fillStyle = t.kind === 'grass' ? shade(TERRAIN.grass, (n - 0.5) * 0.12) : TERRAIN[t.kind];
        ctx.fillRect(x * T, y * T, T, T);
        const detail = DETAIL[t.kind];
        if (!detail) continue;
        ctx.fillStyle = detail;
        if (t.kind === 'forest') {
          for (const [ox, oy] of [[3, 4], [8, 3], [5, 9]]) {
            ctx.beginPath();
            ctx.moveTo(x * T + ox, y * T + oy - 3);
            ctx.lineTo(x * T + ox - 2.5, y * T + oy + 2);
            ctx.lineTo(x * T + ox + 2.5, y * T + oy + 2);
            ctx.fill();
          }
        } else if (t.kind === 'water') {
          ctx.fillRect(x * T + 2 + n * 4, y * T + 4 + n * 4, 4, 1);
        } else {
          for (let i = 0; i < 3; i++) {
            const r = hash(x * 3 + i, y * 7 - i);
            ctx.fillRect(x * T + 2 + r * 7, y * T + 2 + hash(y + i, x) * 7, 2, 2);
          }
        }
      }
    }
    this.terrainVersion = world.terrainVersion;
    this.terrainSeed = world.seed;
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, 2.5);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), 2.5);
}

function hpColor(r: number): string {
  return r > 0.6 ? '#6ee06e' : r > 0.3 ? '#f0c040' : '#f05050';
}

/** 調整 #rrggbb 顏色亮度，amount -1 ~ 1 */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const adj = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** 畫面座標 → 選取的單位或建築 */
export function pickAt(world: World, tx: number, ty: number): Selection | null {
  let best: Unit | null = null;
  let bestD = 0.9;
  for (const u of world.units) {
    const d = Math.hypot(u.x - tx, u.y - ty);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  if (best) return { kind: 'unit', id: best.id };
  const b = world.buildings.find(
    (b) => tx >= b.x && tx < b.x + BUILDING_SIZE && ty >= b.y && ty < b.y + BUILDING_SIZE,
  );
  return b ? { kind: 'building', id: b.id } : null;
}
