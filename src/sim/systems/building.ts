import {
  BUILDING_DEFS, FARM_FOOD_PER_TICK, HQ_FOOD_PER_TICK, TURRETS, buildingCost,
} from '../buildings';
import { BUILDING_SIZE } from '../constants';
import { dist } from '../math';
import { RACES } from '../races';
import { buildRateOf } from '../stats';
import type { Building, BuildingType, Faction, Point, Unit, World } from '../types';
import {
  areHostile, canAfford, centerOf, getBuilding, hqOf, isTargetable, logEvent, pay, sickMult, tileAt,
} from '../util';
import { damageUnit } from './combat';
import { moveTo } from './movement';

export function isBuildingUnlocked(f: Faction, type: BuildingType): boolean {
  return type !== 'hq' && f.tech >= BUILDING_DEFS[type].tech;
}

/** 從營帳向外一圈一圈找空地，建築之間至少留一格通道 */
export function findBuildSpot(world: World, f: Faction): Point | null {
  const hq = hqOf(world, f);
  if (!hq) return null;
  for (let r = 3; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = hq.x + dx;
        const y = hq.y + dy;
        if (isFreeSpot(world, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function isFreeSpot(world: World, x: number, y: number): boolean {
  for (let yy = y; yy < y + BUILDING_SIZE; yy++) {
    for (let xx = x; xx < x + BUILDING_SIZE; xx++) {
      if (tileAt(world, xx, yy)?.kind !== 'grass') return false;
    }
  }
  return !world.buildings.some(
    (b) => b.hp > 0 &&
      x < b.x + BUILDING_SIZE + 1 && x + BUILDING_SIZE + 1 > b.x &&
      y < b.y + BUILDING_SIZE + 1 && y + BUILDING_SIZE + 1 > b.y,
  );
}

export function createBuilding(world: World, f: Faction, type: BuildingType, x: number, y: number, complete: boolean): Building {
  const def = BUILDING_DEFS[type];
  const b: Building = {
    id: world.nextId++,
    type,
    factionId: f.id,
    x,
    y,
    hp: complete ? def.hp : def.hp * 0.1,
    maxHp: def.hp,
    progress: complete ? 1 : 0,
    complete,
    cooldown: 0,
  };
  world.buildings.push(b);
  return b;
}

/** 付錢並放下工地。科技不足、資源不足或沒有空地時回傳 null。 */
export function placeBuilding(world: World, f: Faction, type: BuildingType): Building | null {
  if (!isBuildingUnlocked(f, type)) return null;
  const cost = buildingCost(type, f.race);
  if (!canAfford(f.resources, cost)) return null;
  const spot = findBuildSpot(world, f);
  if (!spot) return null;
  pay(f.resources, cost);
  const b = createBuilding(world, f, type, spot.x, spot.y, false);
  logEvent(world, 'build', `${f.name} 開始建造${BUILDING_DEFS[type].name}`, f.id);
  return b;
}

export function buildTick(world: World, u: Unit, buildingId: number): boolean {
  const b = getBuilding(world, buildingId);
  if (!b || b.complete) return false;
  const c = centerOf(b);
  if (!moveTo(world, u, c.x, c.y, 1.6)) return true;
  const def = BUILDING_DEFS[b.type];
  b.progress = Math.min(1, b.progress + (buildRateOf(u.attrs) * RACES[u.race].buildSpeed * sickMult(u)) / def.work);
  b.hp = Math.max(b.hp, def.hp * (0.1 + 0.9 * b.progress));
  if (b.progress >= 1) {
    b.complete = true;
    const f = world.factions[b.factionId];
    f.stats.built++;
    logEvent(world, 'build', `${f.name} 的${def.name}完工了`, f.id);
    return false;
  }
  return true;
}

/** 已完工建築的被動效果：生產糧食、營帳與箭塔射擊 */
export function updateBuildings(world: World): void {
  for (const b of world.buildings) {
    if (b.hp <= 0 || !b.complete) continue;
    const f = world.factions[b.factionId];
    if (b.type === 'farm') f.resources.food += FARM_FOOD_PER_TICK;
    if (b.type === 'hq') f.resources.food += HQ_FOOD_PER_TICK;

    const turret = TURRETS[b.type];
    if (!turret) continue;
    if (b.cooldown > 0) {
      b.cooldown--;
      continue;
    }
    const c = centerOf(b);
    let target: Unit | undefined;
    let bestD = turret.range;
    for (const e of world.units) {
      if (!isTargetable(e) || !areHostile(world, b.factionId, e.factionId)) continue;
      const d = dist(c.x, c.y, e.x, e.y);
      if (d <= bestD) {
        bestD = d;
        target = e;
      }
    }
    if (!target) continue;
    b.cooldown = turret.cooldown;
    world.effects.push({ x1: c.x, y1: c.y, x2: target.x, y2: target.y, ttl: 3, maxTtl: 3, color: f.color });
    const dmg = (b.type === 'tower' ? turret.dmg * RACES[f.race].towerDamageMult : turret.dmg) * world.rules.damageMult;
    damageUnit(world, target, dmg, f.id, `${f.name}的${BUILDING_DEFS[b.type].name}`);
  }
}
