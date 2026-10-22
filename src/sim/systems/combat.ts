import { BUILDING_DEFS } from '../buildings';
import { MELEE_RANGE, SIGHT } from '../constants';
import { FIST_DMG, ITEM_DEFS } from '../items';
import { clamp, dist } from '../math';
import { cooldownOf, moraleLossMult } from '../stats';
import type { Attributes, Building, Faction, Unit, World } from '../types';
import { areHostile, centerOf, distToBuilding, getBuilding, logEvent, unitLabel } from '../util';
import { moveTo } from './movement';

const BUILDING_ARMOR = 2;

export function weaponStats(u: Unit): { dmg: number; range: number; ranged: boolean } {
  if (!u.weapon) return { dmg: FIST_DMG, range: MELEE_RANGE, ranged: false };
  const def = ITEM_DEFS[u.weapon.defId];
  return { dmg: def.dmg * u.weapon.quality, range: def.range, ranged: def.ranged };
}

export function armorOf(u: Unit): number {
  return u.armor ? ITEM_DEFS[u.armor.defId].armor * u.armor.quality : 0;
}

/** 命中率：攻方敏捷對守方敏捷 */
export function hitChance(att: Attributes, def: Attributes): number {
  return clamp(0.65 + (att.agi - def.agi) * 0.015, 0.3, 0.92);
}

/** 未減免前的傷害：近戰吃力量，遠程吃敏捷 */
export function rawDamage(u: Unit): number {
  const w = weaponStats(u);
  const base = w.dmg + (w.ranged ? u.attrs.agi * 0.25 : u.attrs.str * 0.5);
  return u.sick ? base * 0.75 : base;
}

/** 扣掉護甲與體質減免，最少 1 點 */
export function mitigatedDamage(raw: number, def: Attributes, armor: number): number {
  return Math.max(1, raw - armor - def.con * 0.2);
}

export function damageUnit(world: World, target: Unit, dmg: number, byFaction: number, byLabel: string, byUnit?: Unit): void {
  if (target.hp <= 0) return;
  target.hp -= dmg;
  target.morale = clamp(target.morale - dmg * 0.8 * moraleLossMult(target.attrs), 0, 100);
  if (target.hp > 0) return;

  handleDeath(world, target);
  if (byFaction >= 0) world.factions[byFaction].stats.kills++;
  if (byUnit) {
    byUnit.kills++;
    byUnit.morale = clamp(byUnit.morale + 8, 0, 100);
  }
  logEvent(world, 'combat', `${byLabel} 擊殺了 ${unitLabel(target)}`, byFaction);
}

/** 任何死因都會做的事：記錄陣亡、附近同伴士氣下降 */
export function handleDeath(world: World, target: Unit): void {
  world.factions[target.factionId].stats.deaths++;
  for (const ally of world.units) {
    if (ally.factionId === target.factionId && ally.hp > 0 && dist(ally.x, ally.y, target.x, target.y) < 5) {
      ally.morale = clamp(ally.morale - 8 * moraleLossMult(ally.attrs), 0, 100);
    }
  }
}

export function damageBuilding(world: World, b: Building, dmg: number, byFaction: number): void {
  if (b.hp <= 0) return;
  b.hp -= dmg;
  if (b.hp > 0) return;
  const owner = world.factions[b.factionId];
  const attacker = byFaction >= 0 ? world.factions[byFaction] : null;
  if (b.type === 'hq') {
    eliminateFaction(world, owner, attacker);
  } else {
    const who = attacker ? attacker.name : '天災';
    logEvent(world, 'combat', `${who} 摧毀了 ${owner.name} 的${BUILDING_DEFS[b.type].name}`, byFaction);
  }
}

export function eliminateFaction(world: World, f: Faction, by: Faction | null): void {
  f.alive = false;
  f.eliminatedAt = world.tick;
  for (const u of world.units) if (u.factionId === f.id) u.hp = 0;
  for (const b of world.buildings) if (b.factionId === f.id) b.hp = 0;
  const who = by ? `被 ${by.name} 攻陷` : '毀於天災';
  logEvent(world, 'faction', `${f.name} 的營帳${who}，殘部潰散，陣營覆滅！`, by ? by.id : f.id);
}

function addTracer(world: World, u: Unit, x: number, y: number) {
  world.effects.push({ x1: u.x, y1: u.y, x2: x, y2: y, ttl: 3, maxTtl: 3, color: world.factions[u.factionId].color });
}

export function strikeUnit(world: World, u: Unit, target: Unit): void {
  if (u.cooldown > 0) return;
  u.cooldown = cooldownOf(u.attrs);
  if (weaponStats(u).ranged) addTracer(world, u, target.x, target.y);
  if (!world.rng.chance(hitChance(u.attrs, target.attrs))) return;
  const raw = rawDamage(u) * world.rng.range(0.85, 1.15) * world.rules.damageMult;
  const dmg = mitigatedDamage(raw, target.attrs, armorOf(target));
  damageUnit(world, target, dmg, u.factionId, unitLabel(u), u);
}

export function strikeBuilding(world: World, u: Unit, b: Building): void {
  if (u.cooldown > 0) return;
  u.cooldown = cooldownOf(u.attrs);
  const c = centerOf(b);
  if (weaponStats(u).ranged) addTracer(world, u, c.x, c.y);
  const dmg = Math.max(1, rawDamage(u) * world.rng.range(0.85, 1.15) * world.rules.damageMult - BUILDING_ARMOR);
  damageBuilding(world, b, dmg, u.factionId);
}

/** 追擊並攻擊一個單位。目標消失或跑太遠回傳 false。 */
export function attackUnitTick(world: World, u: Unit, targetId: number): boolean {
  const t = world.unitMap.get(targetId);
  if (!t || t.hp <= 0 || !areHostile(world, u.factionId, t.factionId)) return false;
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > SIGHT * 2) return false;
  const w = weaponStats(u);
  if (d <= w.range) {
    u.path.length = 0;
    strikeUnit(world, u, t);
  } else {
    moveTo(world, u, t.x, t.y, w.range * 0.9);
  }
  return true;
}

export function attackBuildingTick(world: World, u: Unit, targetId: number): boolean {
  const b = getBuilding(world, targetId);
  if (!b || !areHostile(world, u.factionId, b.factionId)) return false;
  const w = weaponStats(u);
  if (distToBuilding(u.x, u.y, b) <= w.range) {
    u.path.length = 0;
    strikeBuilding(world, u, b);
  } else {
    const c = centerOf(b);
    moveTo(world, u, c.x, c.y, w.range * 0.9 + 0.9);
  }
  return true;
}
