import { BUILDING_DEFS } from '../buildings';
import { MELEE_RANGE, SIGHT } from '../constants';
import { FIST_DMG, hasTrait, itemDef } from '../items';
import { clamp, dist } from '../math';
import { cooldownOf, moraleLossMult } from '../stats';
import type { Attributes, Building, Faction, Unit, World } from '../types';
import {
  areHostile, centerOf, distToBuilding, getBuilding, isTargetable, logEvent, popCapOf, popOf, spawnUnit, unitLabel,
} from '../util';
import { adjustRelation } from './treaties';
import { revealAfterAttack } from './troopActions';
import { infect, infectionRisk } from './health';
import { RACES } from '../races';
import { claimLair, hasRelic, lairOfBuilding } from './neutral';
import {
  attackModifiers, auraBonus, floatText, heroCooldownMult, heroDamageTakenMult, onHeroDeath, onHeroHit, onKill,
  onPoisonedDeath,
} from './heroSystem';
import {
  AMBUSH_MULT, CHARGE_DISTANCE, CHARGE_MULT, LIFESTEAL, SAPPER_VS_BUILDING, SPEAR_VS_CAVALRY, STING_INFECT,
} from '../troops';
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

/** 輕羽武器攻速 +25%；英雄天賦與狂暴也會加快 */
const attackCooldown = (world: World, u: Unit) =>
  Math.max(2, Math.round(cooldownOf(u.attrs) * (hasTrait(u.weapon, 'swift') ? 0.8 : 1) * heroCooldownMult(world, u)));

export function damageUnit(world: World, target: Unit, dmg: number, byFaction: number, byLabel: string, byUnit?: Unit): void {
  if (target.hp <= 0) return;
  target.hp -= dmg * heroDamageTakenMult(target);
  if (!RACES[target.race].fearless) {
    const iron = hasRelic(world, target.factionId, 'iron') ? 0.5 : 1;
    target.morale = clamp(target.morale - dmg * 0.8 * moraleLossMult(target.attrs) * iron, 0, 100);
  }
  if (target.hp > 0) return;

  onPoisonedDeath(world, target);
  handleDeath(world, target, `被 ${byLabel} 擊殺`);
  if (byUnit) onKill(world, byUnit, target);
  if (byFaction >= 0) {
    const killer = world.factions[byFaction];
    killer.stats.kills++;
    // 吞噬：蟲族把屍體吃掉，換成研究點數與糧食
    const devour = RACES[killer.race].devour;
    if (devour > 0) {
      killer.research += devour;
      killer.resources.food += devour;
    }
    // 血債：被殺的一方對兇手的觀感變差
    adjustRelation(world, target.factionId, byFaction, -1.5);
  }
  if (byUnit) {
    byUnit.kills++;
    byUnit.morale = clamp(byUnit.morale + 8, 0, 100);
  }
  logEvent(world, 'combat', `${byLabel} 擊殺了 ${unitLabel(target)}`, byFaction);
}

/** 任何死因都會做的事：記錄陣亡、英雄寫入英雄榜、附近同伴士氣下降、可能被死靈族喚起 */
export function handleDeath(world: World, target: Unit, cause = '戰死'): void {
  world.factions[target.factionId].stats.deaths++;
  if (target.hero) onHeroDeath(world, target, cause);
  for (const ally of world.units) {
    if (ally.factionId === target.factionId && ally.hp > 0 && !RACES[ally.race].fearless && dist(ally.x, ally.y, target.x, target.y) < 5) {
      ally.morale = clamp(ally.morale - 8 * moraleLossMult(ally.attrs), 0, 100);
    }
  }
  raiseDead(world, target);
}

/** 招魂半徑：死者附近有死靈族的人，屍骸才可能被喚起 */
const RAISE_RADIUS = 7;

/** 招魂：活人死去時，附近的死靈族有機會把屍骸喚起成骷髏兵（帶著原本的武器） */
function raiseDead(world: World, corpse: Unit): void {
  if (RACES[corpse.race].raiseDead > 0 || corpse.summonedBy !== undefined) return; // 死靈與召喚物不會復生
  for (const f of world.factions) {
    const chance = RACES[f.race].raiseDead;
    if (!f.alive || chance <= 0) continue;
    const necromancerNear = world.units.some(
      (u) => u.factionId === f.id && u.hp > 0 && u !== corpse && dist(u.x, u.y, corpse.x, corpse.y) <= RAISE_RADIUS,
    );
    if (!necromancerNear || popOf(world, f.id) >= popCapOf(world, f.id) + 5 || !world.rng.chance(chance)) continue;
    const skeleton = spawnUnit(world, f, 'warrior');
    if (!skeleton) continue;
    skeleton.x = corpse.x;
    skeleton.y = corpse.y;
    skeleton.name = `${corpse.name}的骸骨`;
    skeleton.weapon = corpse.weapon;
    logEvent(world, 'combat', `☠ ${unitLabel(corpse)} 的屍骸被${f.name}喚起，化為骷髏兵`, f.id);
    return;
  }
}

export function damageBuilding(world: World, b: Building, dmg: number, byFaction: number): void {
  if (b.hp <= 0) return;
  b.hp -= dmg;
  if (b.hp > 0) return;
  const owner = world.factions[b.factionId];
  const attacker = byFaction >= 0 ? world.factions[byFaction] : null;
  const lair = b.type === 'lair' ? lairOfBuilding(world, b.id) : undefined;
  if (lair) {
    claimLair(world, lair, byFaction);
  } else if (b.type === 'hq') {
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
  f.fallReason = `${Math.floor(world.tick / 600)} 分時營帳${who}`;
  logEvent(world, 'faction', `${f.name} 的營帳${who}，殘部潰散，陣營覆滅！`, by ? by.id : f.id);
}

function addTracer(world: World, u: Unit, x: number, y: number) {
  world.effects.push({ x1: u.x, y1: u.y, x2: x, y2: y, ttl: 3, maxTtl: 3, color: world.factions[u.factionId].color });
}

export function strikeUnit(world: World, u: Unit, target: Unit): void {
  if (u.cooldown > 0) return;
  u.cooldown = attackCooldown(world, u);
  if (weaponStats(u).ranged) addTracer(world, u, target.x, target.y);
  if (!world.rng.chance(hitChance(u.attrs, target.attrs))) {
    u.charge = 0;
    revealAfterAttack(world, u);
    return;
  }
  // 烈焰對死靈等不潔之物傷害加倍
  const holyFire = hasTrait(u.weapon, 'flame') && RACES[target.race].unholy ? 2 : 1;
  const war = hasRelic(world, u.factionId, 'war') ? 1.2 : 1;
  const hero = attackModifiers(world, u, target);
  if (hero.crit) world.effects.push({ x1: target.x, y1: target.y, x2: target.x, y2: target.y, ttl: 4, maxTtl: 4, radius: 0.8, color: '#ffe14d' });
  const raw =
    rawDamage(u) * world.rng.range(0.85, 1.15) * world.rules.damageMult * troopMultiplier(u, target) * holyFire * war * hero.mult;
  u.charge = 0;
  revealAfterAttack(world, u);
  const dmg = mitigatedDamage(raw, target.attrs, armorOf(target) + auraBonus(world, target).armor, hasTrait(u.weapon, 'pierce'));
  damageUnit(world, target, dmg, u.factionId, unitLabel(u), u);
  onHeroHit(world, u, target, dmg);
  // 打擊感：英雄相關的傷害與所有暴擊會跳數字
  if (hero.crit || u.hero || target.hero) {
    const color = hero.crit ? '#ffe14d' : target.hero ? '#ff6b6b' : '#ffffff';
    floatText(world, target.x, target.y - 0.4, hero.crit ? `暴擊 ${Math.round(dmg)}` : String(Math.round(dmg)), color, hero.crit ? 13 : 10);
  }
  if (target.hero?.possessed) world.shake = Math.min(8, world.shake + (dmg / target.maxHp) * 40);
  if (u.hero?.possessed && hero.crit) world.shake = Math.min(8, world.shake + 2);
  // 食屍鬼吸血
  if (u.troop === 'ghoul') u.hp = Math.min(u.maxHp, u.hp + dmg * LIFESTEAL);
  // 淬毒武器、毒刺蟲：命中後可能讓對方染病（體質與抗性照算）
  if (target.hp > 0) {
    const poison = (hasTrait(u.weapon, 'venom') ? 0.3 : 0) + (u.troop === 'stinger' ? STING_INFECT : 0);
    if (poison > 0 && world.rng.chance(poison * infectionRisk(world, target))) infect(world, target);
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
  u.cooldown = attackCooldown(world, u);
  const c = centerOf(b);
  if (weaponStats(u).ranged) addTracer(world, u, c.x, c.y);
  const siege =
    (u.troop === 'sapper' ? SAPPER_VS_BUILDING : 1) * (hasTrait(u.weapon, 'flame') ? 2 : 1) *
    (hasRelic(world, u.factionId, 'war') ? 1.2 : 1);
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
