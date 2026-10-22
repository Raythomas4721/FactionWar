import { BUILDING_SIZE } from './constants';
import { HQ_POP } from './buildings';
import { clamp, dist } from './math';
import { ATTR_KEYS, RACES } from './races';
import { maxHpOf } from './stats';
import type {
  Attributes, Building, BuildingType, EventKind, Faction, Point, Resources, Role, Tile, Unit, World,
} from './types';

export const ROLE_NAMES: Record<Role, string> = { worker: '工人', warrior: '戰士', smith: '鐵匠' };

export const RESOURCE_NAMES: Record<keyof Resources, string> = {
  wood: '木材', stone: '石材', ore: '鐵礦', food: '糧食',
};

const MAX_EVENTS = 300;

export function logEvent(world: World, kind: EventKind, text: string, factionId = -1): void {
  world.events.push({ tick: world.tick, kind, text, factionId });
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
}

export function tileAt(world: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.tiles[y * world.width + x];
}

export function isPassable(world: World, x: number, y: number): boolean {
  const t = tileAt(world, x, y);
  return !!t && t.kind !== 'water';
}

export function getBuilding(world: World, id: number): Building | undefined {
  return world.buildings.find((b) => b.id === id && b.hp > 0);
}

export function hqOf(world: World, f: Faction): Building | undefined {
  return getBuilding(world, f.hqId);
}

export function centerOf(b: Building): Point {
  return { x: b.x + BUILDING_SIZE / 2, y: b.y + BUILDING_SIZE / 2 };
}

/** 點到建築物外框的距離（在建築內為 0） */
export function distToBuilding(x: number, y: number, b: Building): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + BUILDING_SIZE));
  const dy = Math.max(b.y - y, 0, y - (b.y + BUILDING_SIZE));
  return Math.hypot(dx, dy);
}

/** 目前所有陣營彼此敵對；M4 加入結盟後在這裡判斷盟友 */
export function areHostile(_world: World, a: number, b: number): boolean {
  return a !== b;
}

/** 生病時工作效率減半 */
export const sickMult = (u: Unit): number => (u.sick ? 0.5 : 1);

export function unitLabel(u: Unit): string {
  return `${RACES[u.race].name}${ROLE_NAMES[u.role]} ${u.name}`;
}

export function enemiesNear(world: World, factionId: number, x: number, y: number, radius: number): Unit[] {
  return world.units.filter(
    (e) => e.hp > 0 && areHostile(world, factionId, e.factionId) && dist(x, y, e.x, e.y) <= radius,
  );
}

export function nearestEnemyUnit(world: World, u: Unit, radius: number): Unit | undefined {
  let best: Unit | undefined;
  let bestD = radius;
  for (const e of world.units) {
    if (e.hp <= 0 || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function factionUnits(world: World, factionId: number): Unit[] {
  return world.units.filter((u) => u.factionId === factionId && u.hp > 0);
}

export function factionBuildings(world: World, factionId: number, type?: BuildingType): Building[] {
  return world.buildings.filter((b) => b.factionId === factionId && b.hp > 0 && (!type || b.type === type));
}

export function hasCompleted(world: World, factionId: number, type: BuildingType): boolean {
  return world.buildings.some((b) => b.factionId === factionId && b.hp > 0 && b.type === type && b.complete);
}

export function popOf(world: World, factionId: number): number {
  return factionUnits(world, factionId).length;
}

export function popCapOf(world: World, factionId: number): number {
  const houses = factionBuildings(world, factionId, 'house').filter((b) => b.complete).length;
  return HQ_POP + houses * RACES[world.factions[factionId].race].popPerHouse;
}

export function canAfford(res: Resources, cost: Partial<Resources>): boolean {
  return (Object.keys(cost) as (keyof Resources)[]).every((k) => res[k] >= (cost[k] ?? 0));
}

export function pay(res: Resources, cost: Partial<Resources>, sign = 1): void {
  for (const k of Object.keys(cost) as (keyof Resources)[]) res[k] -= sign * (cost[k] ?? 0);
}

export function rollAttributes(world: World, base: Attributes): Attributes {
  const a = {} as Attributes;
  for (const k of ATTR_KEYS) a[k] = clamp(Math.round(base[k] + world.rng.normal() * 4), 3, 20);
  return a;
}

export function spawnUnit(world: World, f: Faction, role: Role): Unit | null {
  const hq = hqOf(world, f);
  if (!hq) return null;
  const c = centerOf(hq);
  const race = RACES[f.race];
  const power = world.rules.racePower[f.race];
  const base = { ...race.base };
  for (const k of ATTR_KEYS) base[k] *= power;
  const attrs = rollAttributes(world, base);
  const hp = maxHpOf(attrs);
  const u: Unit = {
    id: world.nextId++,
    name: world.rng.pick(race.names),
    factionId: f.id,
    race: f.race,
    role,
    attrs,
    hp,
    maxHp: hp,
    morale: 70,
    x: c.x + world.rng.range(-1.2, 1.2),
    y: c.y + world.rng.range(-1.2, 1.2),
    path: [],
    pathGoal: null,
    repathAt: 0,
    action: { type: 'idle' },
    thinkAt: world.tick,
    carrying: null,
    weapon: null,
    armor: null,
    cooldown: 0,
    kills: 0,
    bornAt: world.tick,
    sick: false,
    immuneUntil: 0,
    hunger: 0,
    loyalty: 60 + attrs.cha * 2,
  };
  world.units.push(u);
  world.unitMap.set(u.id, u);
  return u;
}
