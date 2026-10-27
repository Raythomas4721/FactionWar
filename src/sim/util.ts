import { BUILDING_SIZE } from './constants';
import { HQ_POP } from './buildings';
import { clamp, dist } from './math';
import { ATTR_KEYS, RACES } from './races';
import { maxHpOf } from './stats';
import { REVEAL_RADIUS, troopName } from './troops';
import type {
  Attributes, Building, BuildingType, EventKind, Faction, Point, Resources, Role, Tile, Troop, Unit, World,
} from './types';

export const ROLE_NAMES: Record<Role, string> = { worker: '工人', warrior: '戰士', smith: '鐵匠', diplomat: '外交官' };

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

/** 只有處於交戰狀態的陣營會互相攻擊；和平與同盟不會 */
export function areHostile(world: World, a: number, b: number): boolean {
  return a !== b && (world.treaties[a]?.[b] ?? 'war') === 'war';
}

/**
 * 能不能被攻擊：出使中的外交官有外交豁免、地底的工兵打不到、
 * 隱身的伏兵要觀察者夠靠近才看得見。
 */
export function isTargetable(u: Unit, fromX?: number, fromY?: number): boolean {
  if (u.hp <= 0 || u.action.type === 'envoy' || u.underground) return false;
  if (u.hidden && (fromX === undefined || fromY === undefined || dist(fromX, fromY, u.x, u.y) > REVEAL_RADIUS)) return false;
  return true;
}

/** 生病時工作效率減半 */
export const sickMult = (u: Unit): number => (u.sick ? 0.5 : 1);

export function unitLabel(u: Unit): string {
  const role = u.role === 'warrior' && u.troop !== 'soldier' ? troopName(u.troop, u.race) : ROLE_NAMES[u.role];
  return `${RACES[u.race].name}${role} ${u.name}`;
}

export function enemiesNear(world: World, factionId: number, x: number, y: number, radius: number): Unit[] {
  return world.units.filter(
    (e) => isTargetable(e, x, y) && areHostile(world, factionId, e.factionId) && dist(x, y, e.x, e.y) <= radius,
  );
}

export function nearestEnemyUnit(world: World, u: Unit, radius: number): Unit | undefined {
  let best: Unit | undefined;
  let bestD = radius;
  for (const e of world.units) {
    if (!isTargetable(e, u.x, u.y) || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 存活中、真正在爭天下的陣營（排除中立怪物） */
export function contenders(world: World): Faction[] {
  return world.factions.filter((f) => f.alive && !f.neutral);
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

export function spawnUnit(world: World, f: Faction, role: Role, troop: Troop = 'soldier', at?: Point): Unit | null {
  const hq = hqOf(world, f);
  if (!hq && !at) return null;
  const c = at ?? centerOf(hq!);
  const race = RACES[f.race];
  const power = world.rules.racePower[f.race];
  const base = { ...race.base };
  for (const k of ATTR_KEYS) base[k] = base[k] * power + f.attrBonus[k];
  const attrs = rollAttributes(world, base);
  const hp = maxHpOf(attrs);
  const u: Unit = {
    id: world.nextId++,
    name: world.rng.pick(race.names),
    factionId: f.id,
    race: f.race,
    role,
    troop: role === 'warrior' ? troop : 'soldier',
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
    charge: 0,
    underground: false,
    hidden: false,
    revealedUntil: 0,
    kills: 0,
    bornAt: world.tick,
    sick: false,
    immuneUntil: 0,
    hunger: 0,
    loyalty: 50 + attrs.cha * 2,
  };
  world.units.push(u);
  world.unitMap.set(u.id, u);
  return u;
}
