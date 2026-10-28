import { TICKS_PER_SECOND } from './constants';
import { MONSTERS } from './lairs';
import { dist } from './math';
import type { Point, World } from './types';
import { centerOf, contenders, distToBuilding, hqOf, isPassable, logEvent, spawnUnit, tileAt } from './util';
import { damageBuilding, damageUnit } from './systems/combat';

/** 隨機世界事件 */
export type WorldEventId = 'harvest' | 'winter' | 'plagueSeason' | 'meteor' | 'beastTide' | 'wildfire' | 'revelation';

export interface WorldEventDef {
  id: WorldEventId;
  name: string;
  icon: string;
  desc: string;
  /** 持續時間（tick），0 = 立即生效的一次性事件 */
  duration: number;
}

const MIN3 = 3 * 60 * TICKS_PER_SECOND;

export const WORLD_EVENTS: Record<WorldEventId, WorldEventDef> = {
  harvest: { id: 'harvest', name: '豐收年', icon: '🌾', desc: '農田產量 ×2、採漿果 ×1.5', duration: MIN3 },
  winter: { id: 'winter', name: '寒冬', icon: '❄', desc: '口糧 ×1.5、採集 ×0.7', duration: MIN3 },
  plagueSeason: { id: 'plagueSeason', name: '瘟疫季節', icon: '☣', desc: '染病機率 ×2.5', duration: MIN3 },
  meteor: { id: 'meteor', name: '流星雨', icon: '🌠', desc: '隕石砸落造成傷害，留下隕鐵礦', duration: 0 },
  beastTide: { id: 'beastTide', name: '獸潮', icon: '🐺', desc: '一群巨狼從荒野衝向某個陣營', duration: 0 },
  wildfire: { id: 'wildfire', name: '野火', icon: '🔥', desc: '一片森林燒成焦土，身處其中的人受傷', duration: 0 },
  revelation: { id: 'revelation', name: '神啟', icon: '✨', desc: '某個陣營的研究突飛猛進', duration: 0 },
};

export const WORLD_EVENT_ORDER = Object.keys(WORLD_EVENTS) as WorldEventId[];

/** 第一個事件在 4 分鐘時，之後每 4～6 分鐘一次 */
const FIRST_EVENT = 4 * 60 * TICKS_PER_SECOND;
const GAP_MIN = 4 * 60 * TICKS_PER_SECOND;
const GAP_MAX = 6 * 60 * TICKS_PER_SECOND;

export interface ActiveEvent {
  id: WorldEventId;
  until: number;
}

export function isEventActive(world: World, id: WorldEventId): boolean {
  return world.activeEvents.some((e) => e.id === id && world.tick < e.until);
}

/** 各系統查詢事件帶來的倍率 */
export function eventMult(world: World, kind: 'farm' | 'forage' | 'gather' | 'upkeep' | 'disease'): number {
  let m = 1;
  if (isEventActive(world, 'harvest')) {
    if (kind === 'farm') m *= 2;
    if (kind === 'forage') m *= 1.5;
  }
  if (isEventActive(world, 'winter')) {
    if (kind === 'upkeep') m *= 1.5;
    if (kind === 'gather' || kind === 'forage') m *= 0.7;
  }
  if (isEventActive(world, 'plagueSeason') && kind === 'disease') m *= 2.5;
  return m;
}

/** 離所有營帳都夠遠、可以走的隨機地點 */
function wildSpot(world: World, minFromHq: number): Point | null {
  const hqs = contenders(world).map((f) => hqOf(world, f)).filter((b) => !!b);
  for (let i = 0; i < 60; i++) {
    const x = world.rng.int(2, world.width - 3);
    const y = world.rng.int(2, world.height - 3);
    if (!isPassable(world, x, y)) continue;
    if (hqs.every((b) => distToBuilding(x, y, b!) > minFromHq)) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function fire(world: World, id: WorldEventId): string | null {
  const rng = world.rng;
  switch (id) {
    case 'harvest':
    case 'winter':
    case 'plagueSeason':
      return WORLD_EVENTS[id].desc;
    case 'meteor': {
      let hits = 0;
      for (let i = 0; i < 3; i++) {
        const p = wildSpot(world, 7);
        if (!p) continue;
        hits++;
        world.effects.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, ttl: 14, maxTtl: 14, radius: 2.2, color: '#ff9a3c' });
        for (const u of world.units) if (u.hp > 0 && dist(u.x, u.y, p.x, p.y) <= 2) damageUnit(world, u, 20, -1, '隕石');
        for (const b of world.buildings) if (b.hp > 0 && distToBuilding(p.x, p.y, b) <= 2) damageBuilding(world, b, 60, -1);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const t = tileAt(world, Math.floor(p.x) + dx, Math.floor(p.y) + dy);
            if (t && t.kind === 'grass') {
              t.kind = 'ore';
              t.amount = 150;
            }
          }
        }
      }
      world.terrainVersion++;
      return hits ? `${hits} 顆隕石墜落，留下了隕鐵礦` : null;
    }
    case 'beastTide': {
      const beast = world.factions.find((f) => f.neutral);
      const targets = contenders(world);
      if (!beast || !targets.length) return null;
      const target = rng.pick(targets);
      const hq = hqOf(world, target);
      if (!hq) return null;
      const home = centerOf(hq);
      // 從離目標最遠的地圖邊緣出發
      const edges: Point[] = [
        { x: 1.5, y: world.height / 2 }, { x: world.width - 1.5, y: world.height / 2 },
        { x: world.width / 2, y: 1.5 }, { x: world.width / 2, y: world.height - 1.5 },
      ];
      const start = edges.reduce((a, b) => (dist(b.x, b.y, home.x, home.y) > dist(a.x, a.y, home.x, home.y) ? b : a));
      const def = MONSTERS.wolf;
      for (let i = 0; i < 4; i++) {
        const u = spawnUnit(world, beast, 'warrior', 'soldier', { x: start.x + rng.range(-1, 1), y: start.y + rng.range(-1, 1) });
        if (!u) continue;
        u.attrs = { ...def.attrs };
        u.hp = u.maxHp = def.hp;
        u.name = '荒野巨狼';
        u.monster = 'wolf';
        u.home = { ...home };
        u.weapon = { id: world.nextId++, defId: def.weapon.id, quality: 1, maker: '天生', custom: def.weapon };
      }
      return `一群荒野巨狼衝向 ${target.name}！`;
    }
    case 'wildfire': {
      const forests = world.tiles.map((t, i) => (t.kind === 'forest' ? i : -1)).filter((i) => i >= 0);
      if (!forests.length) return null;
      const c = rng.pick(forests);
      const cx = (c % world.width) + 0.5;
      const cy = Math.floor(c / world.width) + 0.5;
      let burned = 0;
      for (let y = Math.floor(cy - 3); y <= cy + 3; y++) {
        for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
          const t = tileAt(world, x, y);
          if (t?.kind === 'forest' && dist(x + 0.5, y + 0.5, cx, cy) <= 3) {
            t.kind = 'grass';
            t.amount = 0;
            burned++;
          }
        }
      }
      for (const u of world.units) if (u.hp > 0 && dist(u.x, u.y, cx, cy) <= 3) damageUnit(world, u, 15, -1, '野火');
      world.effects.push({ x1: cx, y1: cy, x2: cx, y2: cy, ttl: 16, maxTtl: 16, radius: 3, color: '#ff5a2a' });
      world.terrainVersion++;
      return `${burned} 格森林化為焦土`;
    }
    case 'revelation': {
      const lucky = rng.pick(contenders(world));
      if (!lucky) return null;
      lucky.research += 250;
      return `${lucky.name} 得到神啟，研究突飛猛進`;
    }
  }
}

/** 每個 tick：到時間就觸發新事件，清掉過期的事件 */
export function updateWorldEvents(world: World): void {
  world.activeEvents = world.activeEvents.filter((e) => world.tick < e.until);
  if (!world.rules.randomEvents) return;
  if (world.nextEventAt === 0) world.nextEventAt = FIRST_EVENT;
  if (world.tick < world.nextEventAt) return;
  world.nextEventAt = world.tick + world.rng.int(GAP_MIN, GAP_MAX);

  // 已經在持續中的事件不會重複
  const pool = WORLD_EVENT_ORDER.filter((id) => !isEventActive(world, id));
  const id = world.rng.pick(pool);
  const def = WORLD_EVENTS[id];
  const detail = fire(world, id);
  if (detail === null) return;
  if (def.duration > 0) world.activeEvents.push({ id, until: world.tick + def.duration });
  logEvent(world, 'world', `${def.icon} ${def.name}：${detail}`, -1);
}
