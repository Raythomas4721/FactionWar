import { BUILDING_DEFS } from '../sim/buildings';
import { BUILDING_SIZE } from '../sim/constants';
import { itemDef } from '../sim/items';
import { MONSTERS, treasureGlyph } from '../sim/lairs';
import type { TileKind, Unit, World } from '../sim/types';

export const TILE_PX = 12;

export type Selection = { kind: 'unit'; id: number } | { kind: 'building'; id: number };

/** 選了神力時，滑鼠位置的預覽：範圍圈，或要被施法的陣營 */
export interface PowerCursor {
  x: number;
  y: number;
  radius: number;
  color: string;
  factionId: number | null;
}

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

  draw(world: World, selection: Selection | null, cursor: PowerCursor | null = null): void {
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
      const lair = b.type === 'lair' ? world.lairs.find((l) => l.buildingId === b.id) : undefined;
      ctx.fillText(lair ? treasureGlyph(lair.treasure) : BUILDING_DEFS[b.type].glyph, x + s / 2, y + s / 2 + 1);
      if (!b.complete) bar(ctx, x + 2, y + s - 4, s - 4, b.progress, '#f5d76e');
      else if (b.hp < b.maxHp) bar(ctx, x + 2, y - 3, s - 4, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
      if (selection?.kind === 'building' && selection.id === b.id) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
      }
    }

    // 箭矢軌跡與神力光環
    for (const e of world.effects) {
      const life = e.ttl / e.maxTtl;
      ctx.globalAlpha = life;
      ctx.strokeStyle = e.color;
      ctx.beginPath();
      if (e.radius) {
        ctx.lineWidth = 3;
        ctx.arc(e.x1 * T, e.y1 * T, e.radius * T * (1.3 - life * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = e.color;
        ctx.globalAlpha = life * 0.25;
        ctx.fill();
        ctx.globalAlpha = life;
      } else {
        ctx.lineWidth = 1;
        ctx.moveTo(e.x1 * T, e.y1 * T);
        ctx.lineTo(e.x2 * T, e.y2 * T);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const u of world.units) this.drawUnit(ctx, world, u, selection);
    if (cursor) this.drawCursor(ctx, world, cursor);
  }

  private drawCursor(ctx: CanvasRenderingContext2D, world: World, c: PowerCursor) {
    const T = TILE_PX;
    ctx.save();
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    if (c.radius > 0) {
      ctx.beginPath();
      ctx.arc(c.x * T, c.y * T, c.radius * T, 0, Math.PI * 2);
      ctx.stroke();
    } else if (c.factionId !== null) {
      const hq = world.buildings.find((b) => b.id === world.factions[c.factionId!].hqId);
      if (hq) {
        const s = BUILDING_SIZE * T;
        ctx.strokeRect(hq.x * T - 4, hq.y * T - 4, s + 8, s + 8);
        ctx.beginPath();
        ctx.moveTo(c.x * T, c.y * T);
        ctx.lineTo((hq.x + 1) * T, (hq.y + 1) * T);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawUnit(ctx: CanvasRenderingContext2D, world: World, u: Unit, selection: Selection | null) {
    const T = TILE_PX;
    const f = world.factions[u.factionId];
    const x = u.x * T;
    const y = u.y * T;
    ctx.globalAlpha = u.action.type === 'retreat' ? 0.6 : 1;
    if (u.hidden) ctx.globalAlpha = 0.35;
    if (u.monster) {
      const big = u.monster === 'dragon';
      const r = big ? 8 : 5;
      ctx.fillStyle = big ? '#b02a1e' : '#7a2420';
      ctx.strokeStyle = '#ff8a6a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe3d6';
      ctx.font = `bold ${big ? 11 : 8}px "Microsoft JhengHei", sans-serif`;
      ctx.fillText(MONSTERS[u.monster].glyph, x, y + 0.5);
      ctx.globalAlpha = 1;
      if (u.hp < u.maxHp) bar(ctx, x - r, y - r - 4, r * 2, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
      if (selection?.kind === 'unit' && selection.id === u.id) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    if (u.underground) {
      // 地底的工兵：只看得到翻動的土堆
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#7a5a3a';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f.color;
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = f.color;
    ctx.strokeStyle = '#0b0f0b';
    ctx.lineWidth = 1;
    if (u.role === 'warrior') {
      ctx.beginPath();
      if (u.troop === 'cavalry') ctx.ellipse(x, y, 6.5, 4, 0, 0, Math.PI * 2);
      else ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (u.troop === 'spearman') {
        ctx.strokeStyle = '#e8e8e8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 5);
        ctx.lineTo(x + 4, y - 9);
        ctx.stroke();
      } else if (u.troop === 'ranger' || u.troop === 'sapper') {
        // 伏兵戴綠帽、工兵戴礦工帽
        ctx.fillStyle = u.troop === 'ranger' ? '#3f9a4a' : '#c89b5a';
        ctx.fillRect(x - 3, y - 6.5, 6, 2.5);
      }
      if (u.weapon && u.troop !== 'spearman') {
        const def = itemDef(u.weapon);
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
    } else if (u.role === 'diplomat') {
      ctx.beginPath();
      ctx.moveTo(x, y - 4.5);
      ctx.lineTo(x - 4, y + 3.5);
      ctx.lineTo(x + 4, y + 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (u.action.type === 'envoy') {
        // 白旗：外交豁免中
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 2);
        ctx.lineTo(x + 3, y - 8);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 3, y - 8, 5, 3.5);
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
    if (u.sick) {
      ctx.strokeStyle = '#b6ff3b';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
