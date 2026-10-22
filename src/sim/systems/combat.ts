import { BUILDING_DEFS } from '../buildings';
import { MELEE_RANGE, SIGHT } from '../constants';
import { FIST_DMG, hasTrait, itemDef } from '../items';
import { clamp, dist } from '../math';
import { cooldownOf, moraleLossMult } from '../stats';
import type { Attributes, Building, Faction, Unit, World } from '../types';
import { areHostile, centerOf, distToBuilding, getBuilding, isTargetable, logEvent, unitLabel } from '../util';
import { adjustRelation } from './treaties';
import { revealAfterAttack } from './troopActions';
import { infect, infectionRisk } from './health';
import { CHARGE_DISTANCE, CHARGE_MULT, SAPPER_VS_BUILDING, SPEAR_VS_CAVALRY, AMBUSH_MULT } from '../troops';
import { moveTo } from './movement';

const BUILDING_ARMOR = 2;

export function weaponStats(u: Unit): { dmg: number; range: number; ranged: boolean } {
  if (!u.weapon) return { dmg: FIST_DMG, range: MELEE_RANGE, ranged: false };
  const def = itemDef(u.weapon);
  return { dmg: def.dmg * u.weapon.quality, range: def.range, ranged: def.ranged };
}

export function armorOf(u: Unit): number {
  return u.armor ? itemDef(u.armor).armor * u.armor.quality : 0;
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

/** 扣掉護甲與體質減免，最少 1 點；破甲武器只吃三成護甲、一半體質減免 */
export function mitigatedDamage(raw: number, def: Attributes, armor: number, pierce = false): number {
  return Math.max(1, raw - armor * (pierce ? 0.3 : 1) - def.con * 0.2 * (pierce ? 0.5 : 1));
}

/** 輕羽武器攻速 +25% */
const attackCooldown = (u: Unit) => Math.round(cooldownOf(u.attrs) * (hasTrait(u.weapon, 'swift') ? 0.8 : 1));

export function damageUnit(world: World, target: Unit, dmg: number, byFaction: number, byLabel: string, byUnit?: Unit): void {
  if (target.hp <= 0) return;
  target.hp -= dmg;
  target.morale = clamp(target.morale - dmg * 0.8 * moraleLossMult(target.attrs), 0, 100);
  if (target.hp > 0) return;

  handleDeath(world, target);
  if (byFaction >= 0) {
    world.factions[byFaction].stats.kills++;
    // 血債：被殺的一方對兇手的觀感變差
    adjustRelation(world, target.factionId, byFaction, -1.5);
  }
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
  u.cooldown = attackCooldown(u);
  if (weaponStats(u).ranged) addTracer(world, u, target.x, target.y);
  if (!world.rng.chance(hitChance(u.attrs, target.attrs))) {
    u.charge = 0;
    revealAfterAttack(world, u);
    return;
  }
  const raw = rawDamage(u) * world.rng.range(0.85, 1.15) * world.rules.damageMult * troopMultiplier(u, target);
  u.charge = 0;
  revealAfterAttack(world, u);
  const dmg = mitigatedDamage(raw, target.attrs, armorOf(target), hasTrait(u.weapon, 'pierce'));
  damageUnit(world, target, dmg, u.factionId, unitLabel(u), u);
  // 淬毒：命中後可能讓對方染病（體質與抗性照算）
  if (target.hp > 0 && hasTrait(u.weapon, 'venom') && world.rng.chance(0.3 * infectionRisk(world, target))) {
    infect(world, target);
  }
}

/** 兵種相剋：騎兵衝鋒、長矛剋騎兵、伏兵暗箭 */
export function troopMultiplier(u: Unit, target: Unit): number {
  let mult = 1;
  if (u.troop === 'cavalry' && u.charge >= CHARGE_DISTANCE && target.troop !== 'spearman') {
    mult *= CHARGE_MULT[u.race] ?? 2;
  }
  if (u.troop === 'spearman' && target.troop === 'cavalry') mult *= SPEAR_VS_CAVALRY;
  if (u.hidden) mult *= AMBUSH_MULT;
  return mult;
}

export function strikeBuilding(world: World, u: Unit, b: Building): void {
  if (u.cooldown > 0) return;
  u.cooldown = attackCooldown(u);
  const c = centerOf(b);
  if (weaponStats(u).ranged) addTracer(world, u, c.x, c.y);
  const siege = (u.troop === 'sapper' ? SAPPER_VS_BUILDING : 1) * (hasTrait(u.weapon, 'flame') ? 2 : 1);
  const dmg = Math.max(1, rawDamage(u) * world.rng.range(0.85, 1.15) * world.rules.damageMult * siege - BUILDING_ARMOR);
  u.charge = 0;
  revealAfterAttack(world, u);
  damageBuilding(world, b, dmg, u.factionId);
}

/** 追擊並攻擊一個單位。目標消失或跑太遠回傳 false。 */
export function attackUnitTick(world: World, u: Unit, targetId: number): boolean {
  const t = world.unitMap.get(targetId);
  if (!t || !isTargetable(t, u.x, u.y) || !areHostile(world, u.factionId, t.factionId)) return false;
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
