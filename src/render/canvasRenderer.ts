import { BUILDING_DEFS } from '../sim/buildings';
import { BUILDING_SIZE } from '../sim/constants';
import { itemDef } from '../sim/items';
import { MONSTERS, treasureGlyph } from '../sim/lairs';
import type { Building, BuildingType, Outpost, TileKind, Unit, World } from '../sim/types';
import { isExplored, isVisible, unitVisible } from '../sim/fog';
import { CAPTURE_RADIUS, OUTPOST_DEFS } from '../sim/outposts';
import { ODDS_LABEL, lairOdds, type Odds } from '../sim/strength';
import { activeLairs } from '../sim/systems/neutral';

export const TILE_PX = 12;

export type Selection = { kind: 'unit'; id: number } | { kind: 'building'; id: number } | { kind: 'outpost'; id: number };

/** 鏡頭：畫面中心（格）與放大倍率 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** 鏡頭不能拍到地圖外面 */
export function clampCamera(world: World, cam: Camera): Camera {
  const halfW = world.width / (2 * cam.zoom);
  const halfH = world.height / (2 * cam.zoom);
  return {
    zoom: cam.zoom,
    x: Math.min(world.width - halfW, Math.max(halfW, cam.x)),
    y: Math.min(world.height - halfH, Math.max(halfH, cam.y)),
  };
}

/** 畫布上的相對位置（0~1）→ 地圖格子座標 */
export function screenToTile(world: World, cam: Camera | null, fx: number, fy: number): { x: number; y: number } {
  if (!cam) return { x: fx * world.width, y: fy * world.height };
  return {
    x: cam.x + ((fx - 0.5) * world.width) / cam.zoom,
    y: cam.y + ((fy - 0.5) * world.height) / cam.zoom,
  };
}

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
  /** 戰爭迷霧：每格一個像素，放大時平滑模糊成柔和的邊緣 */
  private fogCanvas = document.createElement('canvas');
  private fogVersion = -1;
  private fogWorld: World | null = null;
  /** 巢穴勝算每秒算一次就好 */
  private oddsCache = new Map<number, Odds>();
  private oddsTick = -1;

  constructor(private canvas: HTMLCanvasElement) {}

  draw(world: World, selection: Selection | null, cursor: PowerCursor | null = null, camera: Camera | null = null): void {
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
    ctx.fillStyle = '#0e1215';
    ctx.fillRect(0, 0, w, h);

    if (this.terrainVersion !== world.terrainVersion || this.terrainSeed !== world.seed) this.drawTerrain(world);
    // 震動只是畫面效果，用 Math.random 不影響模擬
    const sx = world.shake > 0 ? (Math.random() - 0.5) * world.shake * 2 : 0;
    const sy = world.shake > 0 ? (Math.random() - 0.5) * world.shake * 2 : 0;
    if (camera) {
      ctx.translate(w / 2 + sx, h / 2 + sy);
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x * T, -camera.y * T);
    } else {
      ctx.translate(sx, sy);
    }
    ctx.drawImage(this.terrain, 0, 0, w, h);

    for (const o of world.outposts) this.drawOutpost(ctx, world, o, selection?.kind === 'outpost' && selection.id === o.id);

    // 建築
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of world.buildings) {
      // 迷霧中只看得到去過的地方的建築
      if (world.fog && b.factionId !== world.fog.factionId && !isExplored(world, b.x + 1, b.y + 1)) continue;
      const x = b.x * T;
      const y = b.y * T;
      const s = BUILDING_SIZE * T;
      drawBuilding(ctx, world, b);
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
      if (e.text) continue;
      if (world.fog && !isVisible(world, e.x1, e.y1) && !isVisible(world, e.x2, e.y2)) continue;
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

    // 在船上的人不畫（船上會標示載了幾個人）
    for (const u of world.units) if (u.aboard === undefined && unitVisible(world, u)) this.drawUnit(ctx, world, u, selection);
    this.drawNemeses(ctx, world);
    if (world.kingdom) this.drawLairOdds(ctx, world);
    if (world.fog) this.drawFog(ctx, world, w, h);
    this.drawFloaters(ctx, world, camera);
    if (cursor) this.drawCursor(ctx, world, cursor);
  }

  /** 據點：圓形底座、佔領者顏色的外框，佔領中會有進度弧 */
  private drawOutpost(ctx: CanvasRenderingContext2D, world: World, o: Outpost, selected: boolean) {
    const T = TILE_PX;
    const def = OUTPOST_DEFS[o.kind];
    const x = o.x * T;
    const y = o.y * T;
    const owner = o.owner !== null ? world.factions[o.owner] : null;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = owner ? owner.color : 'rgba(255,255,255,0.35)';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, CAPTURE_RADIUS * T, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = owner ? shade(owner.color, -0.5) : '#2a2f36';
    ctx.strokeStyle = owner ? owner.color : '#c9ced6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, T * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (o.capturing !== null && o.progress > 0) {
      ctx.strokeStyle = world.factions[o.capturing].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, T * 1.25, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2);
      ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, T * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillText(def.glyph, x, y + 1);
  }

  /** 王國模式：巢穴上方標示我軍全軍出動的勝算 */
  private drawLairOdds(ctx: CanvasRenderingContext2D, world: World) {
    const T = TILE_PX;
    const k = world.kingdom!;
    if (Math.abs(world.tick - this.oddsTick) >= 10) {
      this.oddsTick = world.tick;
      this.oddsCache.clear();
      for (const l of activeLairs(world)) this.oddsCache.set(l.buildingId, lairOdds(world, k.player, l));
    }
    ctx.font = 'bold 10px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of activeLairs(world)) {
      const odds = this.oddsCache.get(l.buildingId);
      if (!odds || !isExplored(world, l.center.x, l.center.y)) continue;
      const label = ODDS_LABEL[odds.level];
      const x = l.center.x * T;
      const y = (l.center.y - 1.75) * T;
      const w = ctx.measureText(label.text).width + 14;
      ctx.fillStyle = 'rgba(10,12,14,0.8)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 7, w, 14, 7);
      ctx.fill();
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.beginPath();
      ctx.arc(x - w / 2 + 7, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label.text, x + 3, y + 0.5);
    }
  }

  /** 迷霧：看不到的地方變暗，從沒去過的地方幾乎全黑 */
  private drawFog(ctx: CanvasRenderingContext2D, world: World, w: number, h: number) {
    const fog = world.fog!;
    if (this.fogVersion !== fog.version || this.fogWorld !== world) {
      this.fogVersion = fog.version;
      this.fogWorld = world;
      this.fogCanvas.width = world.width;
      this.fogCanvas.height = world.height;
      const fctx = this.fogCanvas.getContext('2d')!;
      const img = fctx.createImageData(world.width, world.height);
      for (let i = 0; i < fog.visible.length; i++) {
        img.data[i * 4] = 6;
        img.data[i * 4 + 1] = 8;
        img.data[i * 4 + 2] = 11;
        img.data[i * 4 + 3] = fog.visible[i] ? 0 : fog.lastSeen[i] > 0 ? 120 : 238;
      }
      fctx.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, w, h);
    ctx.restore();
  }

  /** 宿敵頭上畫紅色骷髏，仇恨越高越大 */
  private drawNemeses(ctx: CanvasRenderingContext2D, world: World) {
    const T = TILE_PX;
    const grudge = new Map<number, number>();
    for (const f of world.factions) for (const n of f.nemeses) grudge.set(n.unitId, (grudge.get(n.unitId) ?? 0) + n.grudge);
    if (!grudge.size) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [id, g] of grudge) {
      const u = world.unitMap.get(id);
      if (!u || u.hp <= 0 || u.underground || !unitVisible(world, u)) continue;
      const size = Math.min(16, 9 + g / 25);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.fillStyle = '#ff4d4d';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2.5;
      ctx.strokeText('☠', u.x * T + 8, u.y * T - 9);
      ctx.fillText('☠', u.x * T + 8, u.y * T - 9);
    }
  }

  /** 往上飄的傷害數字與連斬字；放大時字不跟著變得太大 */
  private drawFloaters(ctx: CanvasRenderingContext2D, world: World, camera: Camera | null) {
    const T = TILE_PX;
    const scale = camera ? Math.max(0.6, 1 / Math.sqrt(camera.zoom)) : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (const e of world.effects) {
      if (!e.text || !isVisible(world, e.x1, e.y1)) continue;
      const life = e.ttl / e.maxTtl;
      const y = (e.y1 - (1 - life) * 1.4) * T;
      ctx.globalAlpha = Math.min(1, life * 1.6);
      ctx.font = `bold ${Math.round((e.size ?? 10) * scale * (life > 0.85 ? 1.25 : 1))}px "Microsoft JhengHei", sans-serif`;
      ctx.strokeText(e.text, e.x1 * T, y);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, e.x1 * T, y);
    }
    ctx.globalAlpha = 1;
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
    if (!u.underground) {
      // 腳下的影子讓小人有站在地上的感覺
      const r = u.monster === 'dragon' ? 8 : u.monster ? 5 : u.troop === 'cavalry' ? 6 : 4;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(x + 1, y + r * 0.7, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (u.monster) {
      const big = u.monster === 'dragon';
      const r = big ? 8 + Math.sin(world.tick / 8) * 0.6 : 5;
      ctx.fillStyle = big ? '#b02a1e' : '#7a2420';
      ctx.strokeStyle = '#ff8a6a';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = big ? 'rgba(255,90,40,0.8)' : 'rgba(255,120,90,0.5)';
      ctx.shadowBlur = big ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
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
    if (u.troop === 'transport' || u.troop === 'warship') {
      drawShip(ctx, world, u, x, y, selection?.kind === 'unit' && selection.id === u.id);
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
      else ctx.arc(x, y, u.troop === 'scout' ? 3.2 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      highlight(ctx, x, y, u.troop === 'scout' ? 3.2 : 4.5);
      if (u.troop === 'spearman') {
        ctx.strokeStyle = '#e8e8e8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 5);
        ctx.lineTo(x + 4, y - 9);
        ctx.stroke();
      } else if (u.troop === 'scout') {
        // 斥候：頭上一根白羽毛
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 1, y - 3);
        ctx.lineTo(x + 2, y - 8);
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
      highlight(ctx, x, y, 3);
    }
    if (u.carrying && u.carrying.amount > 0) {
      ctx.fillStyle = RESOURCE_DOT[u.carrying.kind];
      ctx.beginPath();
      ctx.arc(x + 3, y - 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (u.followHero !== undefined) {
      // 跟隨英雄的小隊成員：腳下一個金點
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(x, y + 6, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (u.summonedBy !== undefined) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 2]);
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (u.poison && world.tick < u.poison.until) {
      ctx.fillStyle = '#7dff5a';
      for (let i = 0; i < Math.min(3, u.poison.stacks); i++) ctx.fillRect(x - 4 + i * 3, y + 5, 2, 2);
    }
    if (u.hero) {
      // 英雄：頭上金星；附身中再加金色光圈與指向目標的線
      ctx.fillStyle = '#ffd75e';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('★', x, y - 9);
      if (u.hero.possessed) {
        ctx.strokeStyle = '#ffd75e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9 + Math.sin(world.tick / 3) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        const a = u.action;
        const t = a.type === 'attackUnit' ? world.unitMap.get(a.targetId) : undefined;
        const tx = t ? t.x : a.type === 'guard' ? a.x : null;
        const ty = t ? t.y : a.type === 'guard' ? a.y : null;
        if (tx !== null && ty !== null) {
          ctx.globalAlpha = 0.6;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(tx * TILE_PX, ty * TILE_PX);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }
    }
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

  /**
   * 地形（畫一次存起來，資源被採完才重畫）：
   * 草地有大片的深淺變化與草葉，水邊有淺色岸線，森林是一棵棵有影子的樹，
   * 石頭是圓石、鐵礦冒出橘色礦晶、漿果是結了紅果的灌木。
   */
  private drawTerrain(world: World) {
    const T = TILE_PX;
    const dpr = window.devicePixelRatio || 1;
    this.terrain.width = world.width * T * dpr;
    this.terrain.height = world.height * T * dpr;
    const ctx = this.terrain.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const kindAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= world.width || y >= world.height ? null : world.tiles[y * world.width + x].kind;

    // 1. 地面：草地依大範圍的雜訊變化深淺，森林底下比較暗
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const kind = world.tiles[y * world.width + x].kind;
        const n = smoothNoise(x / 5, y / 5) - 0.5;
        if (kind === 'water') {
          // 離岸越遠的海越深
          let deep = 0;
          for (let r = 1; r <= 3; r++) {
            if ([[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => kindAt(x + dx, y + dy) === 'water')) deep = r;
            else break;
          }
          ctx.fillStyle = shade(TERRAIN.water, n * 0.15 - deep * 0.07);
        }
        else ctx.fillStyle = shade(kind === 'forest' ? '#24401f' : TERRAIN.grass, n * 0.14 + (hash(x, y) - 0.5) * 0.04);
        ctx.fillRect(x * T, y * T, T, T);
      }
    }
    // 2. 草葉與岸線
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const kind = world.tiles[y * world.width + x].kind;
        const px = x * T;
        const py = y * T;
        if (kind === 'water') {
          ctx.fillStyle = '#7a8a5a';
          if (kindAt(x, y - 1) && kindAt(x, y - 1) !== 'water') ctx.fillRect(px, py, T, 2);
          if (kindAt(x, y + 1) && kindAt(x, y + 1) !== 'water') ctx.fillRect(px, py + T - 2, T, 2);
          if (kindAt(x - 1, y) && kindAt(x - 1, y) !== 'water') ctx.fillRect(px, py, 2, T);
          if (kindAt(x + 1, y) && kindAt(x + 1, y) !== 'water') ctx.fillRect(px + T - 2, py, 2, T);
          ctx.strokeStyle = 'rgba(160,200,235,0.35)';
          ctx.lineWidth = 1;
          const h = hash(x, y);
          ctx.beginPath();
          ctx.arc(px + 3 + h * 5, py + 5 + h * 3, 2.5, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          continue;
        }
        if (kind === 'grass') {
          for (let i = 0; i < 3; i++) {
            const hx = hash(x * 5 + i, y * 3);
            const hy = hash(y * 5 - i, x * 7);
            ctx.fillStyle = i === 0 ? 'rgba(120,170,90,0.35)' : 'rgba(20,40,18,0.3)';
            ctx.fillRect(px + 1 + hx * 9, py + 1 + hy * 9, 1, 2);
          }
        }
      }
    }
    // 3. 資源：由上往下畫，下面的樹會蓋住上面的樹根，看起來比較立體
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const kind = world.tiles[y * world.width + x].kind;
        const px = x * T;
        const py = y * T;
        const h = hash(x, y);
        if (kind === 'forest') {
          const trees = h < 0.5 ? [[4, 5, 3.6], [8.5, 8, 3.4]] : [[6, 4.5, 3.8], [3.5, 9, 3], [9.5, 9.5, 3]];
          for (const [ox, oy, r] of trees) tree(ctx, px + ox, py + oy, r * (0.9 + hash(x + ox, y + oy) * 0.25));
        } else if (kind === 'rock' || kind === 'ore') {
          boulder(ctx, px + 4 + h * 2, py + 6, 3.6, '#7d8289');
          boulder(ctx, px + 8.5, py + 8.5 - h * 2, 2.8, '#6c7178');
          if (kind === 'ore') {
            ctx.fillStyle = DETAIL.ore!;
            for (const [ox, oy] of [[3, 5], [7.5, 8], [9, 4]]) {
              ctx.beginPath();
              ctx.moveTo(px + ox, py + oy - 2.5);
              ctx.lineTo(px + ox + 1.5, py + oy + 1);
              ctx.lineTo(px + ox - 1.5, py + oy + 1);
              ctx.closePath();
              ctx.fill();
            }
          }
        } else if (kind === 'berries') {
          const ripe = world.tiles[y * world.width + x].amount >= 8;
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath();
          ctx.ellipse(px + 6.5, py + 9, 4.5, 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3d6b2a';
          ctx.beginPath();
          ctx.arc(px + 4.5, py + 6, 3, 0, Math.PI * 2);
          ctx.arc(px + 8, py + 6.5, 3.2, 0, Math.PI * 2);
          ctx.fill();
          // 被摘光的漿果叢只剩葉子，等果子長回來
          if (ripe) {
            ctx.fillStyle = DETAIL.berries!;
            for (const [ox, oy] of [[3.5, 5], [6.5, 4.5], [8.5, 7], [5, 7.5]]) ctx.fillRect(px + ox, py + oy, 1.6, 1.6);
          }
        }
      }
    }
    // 4. 古地道的入口：石砌的洞口
    for (const t of world.tunnels) for (const end of [t.a, t.b]) tunnelMouth(ctx, (end.x + 0.5) * T, (end.y + 0.5) * T);
    this.terrainVersion = world.terrainVersion;
    this.terrainSeed = world.seed;
  }
}

/** 古地道入口：一圈石塊圍著黑漆漆的洞口 */
function tunnelMouth(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 1, y + 3, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.95 + (i / 8) * Math.PI * 1.1;
    boulder(ctx, x + Math.cos(a) * 7, y + Math.sin(a) * 5.5 + 1, 2.4, i % 2 ? '#8a8f96' : '#767b82');
  }
  ctx.fillStyle = '#0d0b0a';
  ctx.beginPath();
  ctx.ellipse(x, y + 1.5, 5, 3.6, 0, Math.PI, 0);
  ctx.lineTo(x + 5, y + 3.5);
  ctx.lineTo(x - 5, y + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 8px "Microsoft JhengHei", "PingFang TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(10,12,14,0.75)';
  ctx.fillRect(x - 11, y + 7, 22, 10);
  ctx.fillStyle = '#e8d9b0';
  ctx.fillText('古地道', x, y + 12.5);
}

/** 一棵樹：影子、樹冠、亮面 */
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 1, y + r * 0.8, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f6a2e';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DETAIL.forest!;
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

/** 一顆圓石：影子、石身、亮面 */
function boulder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 1, y + r * 0.6, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DETAIL.rock!;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 圓形身體左上角的反光 */
function highlight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/** 平滑的雜訊（格點雜湊做雙線性內插），讓草地有大片的深淺 */
function smoothNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 建築用的材質：木造或石造 */
const STONE_BUILDINGS = new Set<BuildingType>(['forge', 'barracks', 'tower', 'library']);

function drawBuilding(ctx: CanvasRenderingContext2D, world: World, b: Building) {
  const T = TILE_PX;
  const f = world.factions[b.factionId];
  const x = b.x * T;
  const y = b.y * T;
  const s = BUILDING_SIZE * T;
  ctx.globalAlpha = b.complete ? 1 : 0.5;
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 3, y + 4, s - 3, s - 3);

  if (b.type === 'lair') {
    const lair = world.lairs.find((l) => l.buildingId === b.id);
    ctx.fillStyle = '#4a3f38';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s / 2 + 2, s / 2, s / 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b5d52';
    ctx.beginPath();
    ctx.ellipse(x + s / 2 - 3, y + s / 2 - 1, s / 3, s / 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0907';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s / 2 + 4, s / 4.5, s / 6, 0, Math.PI, 0);
    ctx.fill();
    if (lair) badgeText(ctx, treasureGlyph(lair.treasure), x + s / 2, y + 5, '#ffd27a');
    ctx.globalAlpha = 1;
    return;
  }

  if (b.type === 'dock') {
    // 碼頭：木棧板、繫船柱，陣營色的旗子
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x + 1, y + 3, s - 2, s - 6);
    ctx.strokeStyle = '#3e2a17';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 1 + i * ((s - 2) / 6), y + 3);
      ctx.lineTo(x + 1 + i * ((s - 2) / 6), y + s - 3);
      ctx.stroke();
    }
    ctx.fillStyle = '#2b1d10';
    for (const [px, py] of [[4, 4], [s - 5, 4], [4, s - 5], [s - 5, s - 5]]) {
      ctx.beginPath();
      ctx.arc(x + px, y + py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1.5, y + 3.5, s - 3, s - 7);
    ctx.globalAlpha = 1;
    badgeText(ctx, '⚓', x + s / 2, y + s / 2, '#fff');
    return;
  }

  if (b.type === 'farm') {
    ctx.fillStyle = '#5b4026';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#c9b24a' : '#7fa83c';
      ctx.fillRect(x + 3, y + 3 + i * 4.6, s - 6, 2.6);
    }
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
    ctx.globalAlpha = 1;
    return;
  }

  // 牆面（木造或石造）＋陣營色屋頂
  const stone = STONE_BUILDINGS.has(b.type);
  const roofH = b.type === 'tower' ? 6 : 9;
  ctx.fillStyle = b.type === 'hq' ? shade(f.color, -0.35) : stone ? '#8d9298' : '#9b7a52';
  ctx.fillRect(x + 2, y + roofH - 1, s - 4, s - roofH - 1);
  ctx.fillStyle = shade(f.color, -0.15);
  if (b.type === 'tower') {
    // 城垛
    ctx.fillRect(x + 2, y + 2, s - 4, roofH);
    ctx.fillStyle = shade(f.color, -0.5);
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * 5.5, y + 1, 3, 3);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + roofH + 1);
    ctx.lineTo(x + s / 2, y + 0.5);
    ctx.lineTo(x + s - 0.5, y + roofH + 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(f.color, -0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (b.type === 'hq') {
    // 營帳的旗子
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + 1);
    ctx.lineTo(x + s / 2, y - 8);
    ctx.stroke();
    ctx.fillStyle = f.color;
    const wave = Math.sin(world.tick / 6) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y - 8);
    ctx.lineTo(x + s / 2 + 8, y - 6 + wave);
    ctx.lineTo(x + s / 2, y - 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = f.color;
  ctx.lineWidth = b.type === 'hq' ? 2 : 1;
  ctx.strokeRect(x + 2, y + roofH - 1, s - 4, s - roofH - 1);
  ctx.globalAlpha = 1;
  ctx.font = `bold ${b.type === 'hq' ? 11 : 10}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const ty = y + roofH + (s - roofH) / 2;
  ctx.strokeText(BUILDING_DEFS[b.type].glyph, x + s / 2, ty);
  ctx.fillStyle = b.complete ? '#fff' : 'rgba(255,255,255,0.7)';
  ctx.fillText(BUILDING_DEFS[b.type].glyph, x + s / 2, ty);
}

/** 船：木造船身、陣營色的帆；戰船有弩砲，運兵船標出載了幾個人 */
function drawShip(ctx: CanvasRenderingContext2D, world: World, u: Unit, x: number, y: number, selected: boolean) {
  const f = world.factions[u.factionId];
  const war = u.troop === 'warship';
  const len = war ? 9 : 10;
  // 朝著要去的方向
  const node = u.path[0];
  const dir = node ? Math.sign(node.x + 0.5 - u.x) || 1 : u.factionId % 2 ? -1 : 1;
  const bob = Math.sin(world.tick / 7 + u.id) * 0.6;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(dir, 1);
  // 船尾的水紋
  ctx.strokeStyle = 'rgba(200,225,245,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len - 2, 3);
  ctx.lineTo(-len - 7, 1.5);
  ctx.moveTo(-len - 2, 5);
  ctx.lineTo(-len - 7, 6);
  ctx.stroke();
  // 船身
  ctx.fillStyle = war ? '#4a3524' : '#6e4d2e';
  ctx.strokeStyle = '#21160c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len, 1);
  ctx.lineTo(len, 1);
  ctx.lineTo(len - 4, 6);
  ctx.lineTo(-len + 3, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 桅杆與帆
  ctx.strokeStyle = '#2a1c10';
  ctx.beginPath();
  ctx.moveTo(-1, 1);
  ctx.lineTo(-1, -11);
  ctx.stroke();
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.quadraticCurveTo(7, -5, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  if (war) {
    // 船頭的弩砲
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(len - 6, -1.5, 5, 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(len - 4, -2.5, 1.5, 4);
  }
  ctx.restore();
  if (u.troop === 'transport') {
    const cargo = world.units.filter((p) => p.aboard === u.id && p.hp > 0).length;
    if (cargo) badgeText(ctx, `👥${cargo}`, x, y - 15, '#fff');
  }
  if (u.hp < u.maxHp) bar(ctx, x - 9, y + 9, 18, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
  if (selected) {
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, 14, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 深色圓角底的小字（巢穴寶藏） */
function badgeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = 'bold 9px "Microsoft JhengHei", "PingFang TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 5.5, 12, 11, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 0.5);
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
/** radius：點擊容許的距離（格），手機上地圖小時要放寬 */
export function pickAt(world: World, tx: number, ty: number, radius = 0.9): Selection | null {
  let best: Unit | null = null;
  let bestD = radius;
  for (const u of world.units) {
    if (!unitVisible(world, u)) continue;
    const d = Math.hypot(u.x - tx, u.y - ty);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  // 點在據點中心附近、而且比任何小人都近，就選據點
  for (const o of world.outposts) {
    const d = Math.hypot(o.x - tx, o.y - ty);
    if (d < Math.max(1, radius) && d < bestD) return { kind: 'outpost', id: o.id };
  }
  if (best) return { kind: 'unit', id: best.id };
  const b = world.buildings.find(
    (b) => tx >= b.x && tx < b.x + BUILDING_SIZE && ty >= b.y && ty < b.y + BUILDING_SIZE && isExplored(world, b.x + 1, b.y + 1),
  );
  return b ? { kind: 'building', id: b.id } : null;
}
