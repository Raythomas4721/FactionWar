import { BUILDING_SIZE } from './constants';
import { dist } from './math';
import type { Faction, Resources, TileKind, World } from './types';
import {
  centerOf, distToBuilding, hasCompleted, hqOf, logEvent, spawnUnit, tileAt, unitLabel,
} from './util';
import { damageBuilding, damageUnit } from './systems/combat';
import { pickCraftDef } from './systems/crafting';
import { infect, infectionRisk } from './systems/health';

/**
 * 上帝之手：玩家直接介入世界的神力。
 * 施法立即生效並記錄在事件日誌；消耗神力值（世界法則可設為無限）。
 */

export type PowerId = 'lightning' | 'plague' | 'bless' | 'gift' | 'reinforce' | 'forest' | 'ore';

export interface PowerDef {
  id: PowerId;
  name: string;
  icon: string;
  cost: number;
  /** 作用半徑（格）；0 代表作用於離點擊處最近的陣營 */
  radius: number;
  color: string;
  desc: string;
}

export const POWER_DEFS: Record<PowerId, PowerDef> = {
  lightning: { id: 'lightning', name: '天雷', icon: '⚡', cost: 30, radius: 2.5, color: '#fff27a',
    desc: '對範圍內所有小人造成 30 點傷害，建築 80 點，不分敵我' },
  plague: { id: 'plague', name: '瘟疫', icon: '☣', cost: 40, radius: 3, color: '#b6ff3b',
    desc: '範圍內小人可能染病，體質高的（尤其矮人）能抵抗；之後會互相傳染' },
  bless: { id: 'bless', name: '祝福', icon: '✨', cost: 20, radius: 3, color: '#7affc8',
    desc: '範圍內小人生命全滿、士氣全滿、疾病痊癒、不再飢餓' },
  gift: { id: 'gift', name: '恩賜', icon: '💰', cost: 35, radius: 0, color: '#ffd75e',
    desc: '點擊處最近的陣營獲得一批木、石、礦、糧' },
  reinforce: { id: 'reinforce', name: '援軍', icon: '🛡', cost: 50, radius: 0, color: '#9ec5ff',
    desc: '點擊處最近的陣營在營帳出現 3 名配好武器的戰士' },
  forest: { id: 'forest', name: '造林', icon: '🌲', cost: 10, radius: 1.5, color: '#5fd068',
    desc: '把範圍內的草地變成森林' },
  ore: { id: 'ore', name: '礦脈', icon: '⛏', cost: 15, radius: 1.5, color: '#e0904a',
    desc: '把範圍內的草地變成鐵礦' },
};

export const POWER_ORDER: PowerId[] = ['lightning', 'plague', 'bless', 'gift', 'reinforce', 'forest', 'ore'];

const GIFT: Resources = { wood: 80, stone: 60, ore: 50, food: 80 };

export interface CastResult {
  ok: boolean;
  message: string;
}

/** 離 (x, y) 最近、仍存活的陣營（以營帳中心計算） */
export function nearestFaction(world: World, x: number, y: number): Faction | null {
  let best: Faction | null = null;
  let bestD = Infinity;
  for (const f of world.factions) {
    const hq = f.alive ? hqOf(world, f) : undefined;
    if (!hq) continue;
    const c = centerOf(hq);
    const d = dist(x, y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export function castPower(world: World, id: PowerId, x: number, y: number): CastResult {
  const def = POWER_DEFS[id];
  if (world.over) return { ok: false, message: '戰局已結束' };
  if (world.mana < def.cost) return { ok: false, message: `神力不足（需要 ${def.cost}）` };

  const result = apply(world, def, x, y);
  if (!result.ok) return result;
  if (!world.rules.infiniteMana) world.mana -= def.cost;
  if (def.radius > 0) {
    world.effects.push({ x1: x, y1: y, x2: x, y2: y, ttl: 12, maxTtl: 12, radius: def.radius, color: def.color });
  }
  logEvent(world, 'god', `${def.icon} ${result.message}`);
  return result;
}

function apply(world: World, def: PowerDef, x: number, y: number): CastResult {
  switch (def.id) {
    case 'lightning': {
      const victims = world.units.filter((u) => u.hp > 0 && dist(u.x, u.y, x, y) <= def.radius);
      for (const u of victims) damageUnit(world, u, 30, -1, '天雷');
      const killed = victims.filter((u) => u.hp <= 0).length;
      const hitBuildings = world.buildings.filter((b) => b.hp > 0 && distToBuilding(x, y, b) <= def.radius);
      for (const b of hitBuildings) damageBuilding(world, b, 80, -1);
      const parts = [`擊中 ${victims.length} 名小人`];
      if (killed) parts.push(`${killed} 名喪命`);
      if (hitBuildings.length) parts.push(`${hitBuildings.length} 棟建築受損`);
      return { ok: true, message: `天雷劈落！${parts.join('，')}` };
    }
    case 'bless': {
      const blessed = world.units.filter((u) => u.hp > 0 && dist(u.x, u.y, x, y) <= def.radius);
      if (!blessed.length) return { ok: false, message: '範圍內沒有小人' };
      for (const u of blessed) {
        u.hp = u.maxHp;
        u.morale = 100;
        u.hunger = 0;
        if (u.sick) {
          u.sick = false;
          u.immuneUntil = world.tick + 2000;
        }
      }
      const names = blessed.slice(0, 3).map(unitLabel).join('、');
      return { ok: true, message: `神聖祝福降臨在 ${names}${blessed.length > 3 ? ` 等 ${blessed.length} 人` : ''} 身上` };
    }
    case 'plague': {
      const targets = world.units.filter((u) => u.hp > 0 && !u.sick && dist(u.x, u.y, x, y) <= def.radius);
      if (!targets.length) return { ok: false, message: '範圍內沒有健康的小人' };
      // 神降的瘟疫比自然傳染猛烈，但體質與種族抗性仍然有效
      const infected = targets.filter((u) => world.rng.chance(Math.min(1, 0.9 * infectionRisk(world, u) / Math.max(world.rules.diseaseMult, 0.01))) && infect(world, u));
      const resisted = targets.length - infected.length;
      return { ok: true, message: `瘟疫降臨！${infected.length} 人染病${resisted ? `，${resisted} 人靠體質抵抗住了` : ''}` };
    }
    case 'gift': {
      const f = nearestFaction(world, x, y);
      if (!f) return { ok: false, message: '沒有存活的陣營' };
      for (const k of Object.keys(GIFT) as (keyof Resources)[]) f.resources[k] += GIFT[k];
      return { ok: true, message: `${f.name} 獲得神的恩賜：木 ${GIFT.wood}、石 ${GIFT.stone}、礦 ${GIFT.ore}、糧 ${GIFT.food}` };
    }
    case 'reinforce': {
      const f = nearestFaction(world, x, y);
      if (!f) return { ok: false, message: '沒有存活的陣營' };
      const weaponDef = pickCraftDef(f, hasCompleted(world, f.id, 'forge'), 'weapon');
      for (let i = 0; i < 3; i++) {
        const u = spawnUnit(world, f, 'warrior');
        if (u && weaponDef) u.weapon = { id: world.nextId++, defId: weaponDef.id, quality: 1, maker: '神賜' };
      }
      return { ok: true, message: `三名神選戰士加入了 ${f.name}${weaponDef ? `，手持${weaponDef.name}` : ''}` };
    }
    case 'forest':
    case 'ore': {
      const kind: TileKind = def.id;
      const amount = def.id === 'forest' ? 50 : 80;
      let changed = 0;
      for (let ty = Math.floor(y - def.radius); ty <= Math.ceil(y + def.radius); ty++) {
        for (let tx = Math.floor(x - def.radius); tx <= Math.ceil(x + def.radius); tx++) {
          const t = tileAt(world, tx, ty);
          if (!t || t.kind !== 'grass') continue;
          if (dist(tx + 0.5, ty + 0.5, x, y) > def.radius) continue;
          if (world.buildings.some((b) => tx >= b.x && tx < b.x + BUILDING_SIZE && ty >= b.y && ty < b.y + BUILDING_SIZE)) continue;
          t.kind = kind;
          t.amount = amount;
          changed++;
        }
      }
      if (!changed) return { ok: false, message: '這裡沒有可以改變的草地' };
      world.terrainVersion++;
      return { ok: true, message: `大地變動，長出了 ${changed} 格${def.id === 'forest' ? '森林' : '鐵礦'}` };
    }
  }
}
