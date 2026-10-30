import { BUILDING_SIZE, SIGHT } from './constants';
import { dist } from './math';
import { LEASH } from './lairs';
import { OUTPOST_DEFS } from './outposts';
import type { BuildingType, FogState, Point, Unit, World } from './types';
import { centerOf, contenders, hqOf } from './util';

/**
 * 戰爭迷霧：只有玩家的陣營受影響（AI 看得到全圖）。
 * 小人、建築與佔領的據點提供視野；去過但現在看不到的地方會變暗，從沒去過的地方是黑的。
 */

export const SCOUT_SIGHT = 11;
/** 船隻的視野 */
const SHIP_SIGHT = 9;
const HERO_SIGHT = 8;
const FOG_UPDATE_TICKS = 3;
const BUILDING_SIGHT: Partial<Record<BuildingType, number>> = { hq: 8, tower: 9 };

export function createFog(world: World, factionId: number): FogState {
  const n = world.width * world.height;
  const fog: FogState = { factionId, lastSeen: new Int32Array(n), visible: new Uint8Array(n), version: 0, scoutTarget: null };
  world.fog = fog;
  refreshFog(world, fog);
  return fog;
}

export function sightOf(u: Unit): number {
  if (u.troop === 'scout') return SCOUT_SIGHT;
  if (u.troop === 'transport' || u.troop === 'warship') return SHIP_SIGHT;
  return u.hero ? HERO_SIGHT : SIGHT;
}

export function updateFog(world: World): void {
  const fog = world.fog;
  if (fog && world.tick % FOG_UPDATE_TICKS === 0) refreshFog(world, fog);
}

function refreshFog(world: World, fog: FogState): void {
  fog.visible.fill(0);
  const stamp = (cx: number, cy: number, r: number) => {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(world.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(world.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) fog.visible[y * world.width + x] = 1;
      }
    }
  };
  for (const u of world.units) if (u.factionId === fog.factionId && u.hp > 0 && u.aboard === undefined) stamp(u.x, u.y, sightOf(u));
  for (const b of world.buildings) {
    if (b.factionId !== fog.factionId) continue;
    stamp(b.x + BUILDING_SIZE / 2, b.y + BUILDING_SIZE / 2, BUILDING_SIGHT[b.type] ?? 5);
  }
  for (const o of world.outposts) if (o.owner === fog.factionId) stamp(o.x, o.y, OUTPOST_DEFS[o.kind].vision);
  const seen = world.tick + 1;
  for (let i = 0; i < fog.visible.length; i++) if (fog.visible[i]) fog.lastSeen[i] = seen;
  fog.version++;
}

const tileIndex = (world: World, x: number, y: number) => {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return tx < 0 || ty < 0 || tx >= world.width || ty >= world.height ? -1 : ty * world.width + tx;
};

/** 玩家現在看不看得到這一點（沒有迷霧時永遠看得到） */
export function isVisible(world: World, x: number, y: number): boolean {
  const fog = world.fog;
  if (!fog) return true;
  const i = tileIndex(world, x, y);
  return i >= 0 && fog.visible[i] === 1;
}

/** 玩家有沒有去過這一點 */
export function isExplored(world: World, x: number, y: number): boolean {
  const fog = world.fog;
  if (!fog) return true;
  const i = tileIndex(world, x, y);
  return i >= 0 && fog.lastSeen[i] > 0;
}

/** 這個小人在玩家眼中看不看得到：自己人永遠看得到 */
export function unitVisible(world: World, u: Unit): boolean {
  return !world.fog || u.factionId === world.fog.factionId || isVisible(world, u.x, u.y);
}

/** 玩家指定偵察地點，所有斥候都會前往 */
export function setScoutTarget(world: World, x: number, y: number): void {
  if (world.fog) world.fog.scoutTarget = { x, y };
}

/**
 * 斥候下一個要去的地方：玩家指定的地點優先；
 * 否則在據點、巢穴、敵營外圍與隨機地點中，挑最久沒看過的地方。
 */
export function pickScoutTarget(world: World, u: Unit): Point {
  const fog = world.fog?.factionId === u.factionId ? world.fog : undefined;
  if (fog?.scoutTarget) {
    if (dist(u.x, u.y, fog.scoutTarget.x, fog.scoutTarget.y) > 2) return fog.scoutTarget;
    fog.scoutTarget = null;
  }
  const mid = { x: world.width / 2, y: world.height / 2 };
  const candidates: Point[] = world.outposts.map((o) => ({ x: o.x, y: o.y }));
  // 怪物巢穴附近太危險，斥候遠遠看就好
  const lairs = world.lairs.filter((l) => l.claimedBy === null);
  const nearLair = (p: Point) => lairs.some((l) => dist(p.x, p.y, l.center.x, l.center.y) < LEASH + 4);
  for (const e of contenders(world)) {
    const hq = e.id === u.factionId ? undefined : hqOf(world, e);
    if (!hq) continue;
    // 敵營外圍（往地圖中央退 10 格），不要直接衝進箭塔射程；斥候視野 11 格還是看得到營帳
    const c = centerOf(hq);
    const d = Math.max(1, dist(c.x, c.y, mid.x, mid.y));
    candidates.push({ x: c.x + ((mid.x - c.x) / d) * 10, y: c.y + ((mid.y - c.y) / d) * 10 });
  }
  for (let i = 0; i < 4; i++) {
    candidates.push({ x: world.rng.range(2, world.width - 2), y: world.rng.range(2, world.height - 2) });
  }
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const p of candidates) {
    const i = tileIndex(world, p.x, p.y);
    if ((i >= 0 && world.tiles[i].kind === 'water') || nearLair(p)) continue;
    const age = fog && i >= 0 ? world.tick + 1 - fog.lastSeen[i] : world.rng.range(0, 600);
    const score = age - dist(u.x, u.y, p.x, p.y) * 8 + world.rng.range(0, 60);
    if (score > bestScore && dist(u.x, u.y, p.x, p.y) > 3) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
