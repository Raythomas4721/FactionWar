import { clamp, dist } from '../math';
import { RACES } from '../races';
import { diseaseResistOf, recoveryRateOf } from '../stats';
import { TROOP_DEFS } from '../troops';
import { hasTrait } from '../items';
import type { Faction, Unit, World } from '../types';
import { centerOf, factionBuildings, logEvent, unitLabel } from '../util';
import { handleDeath } from './combat';

/** 每人每 tick 吃掉的糧食（再乘種族食量與世界法則） */
export const UPKEEP_PER_TICK = 0.003;
const HUNGER_RISE = 0.0015;
const HUNGER_FALL = 0.01;
const STARVE_DAMAGE = 0.04;

const CONTAGION_RADIUS = 1.5;
const CONTAGION_CHANCE = 0.006;
const SPONTANEOUS_CHANCE = 0.00003;
const SICK_DAMAGE = 0.035;
const IMMUNITY_TICKS = 2000;
const INFIRMARY_RADIUS = 4;

/** 這名小人實際的染病機率倍率：體質 × 種族 × 世界法則 */
export function infectionRisk(world: World, u: Unit): number {
  const blessed = hasTrait(u.armor, 'blessed') ? 0.5 : 1;
  return diseaseResistOf(u.attrs) * RACES[u.race].diseaseMult * world.rules.diseaseMult * blessed;
}

/** 要吃飯的「人份」：騎兵連坐騎算 1.5 份 */
export function eatersOf(units: Unit[]): number {
  return units.reduce((s, u) => s + TROOP_DEFS[u.troop].upkeep, 0);
}

export function upkeepOf(world: World, f: Faction, pop: number): number {
  return pop * UPKEEP_PER_TICK * RACES[f.race].foodUpkeep * world.rules.upkeepMult;
}

/** 飢餓、疾病等非戰鬥傷害 */
export function naturalDamage(world: World, u: Unit, dmg: number, cause: 'disease' | 'hunger'): void {
  if (u.hp <= 0) return;
  u.hp -= dmg;
  if (u.hp > 0) return;
  handleDeath(world, u);
  const f = world.factions[u.factionId];
  if (cause === 'disease') f.stats.diseaseDeaths++;
  else f.stats.starved++;
  logEvent(world, 'health', `${unitLabel(u)} ${cause === 'disease' ? '病死了' : '餓死了'}`, u.factionId);
}

export function infect(world: World, u: Unit): boolean {
  if (u.sick || u.hp <= 0 || world.tick < u.immuneUntil) return false;
  u.sick = true;
  world.factions[u.factionId].stats.infections++;
  return true;
}

/** 每個陣營先付口糧；付不出來的陣營全員飢餓度上升 */
export function updateHunger(world: World): void {
  const pops = new Map<number, Unit[]>();
  for (const u of world.units) {
    if (u.hp <= 0) continue;
    const list = pops.get(u.factionId) ?? [];
    list.push(u);
    pops.set(u.factionId, list);
  }
  for (const f of world.factions) {
    if (!f.alive) continue;
    const units = pops.get(f.id) ?? [];
    const need = upkeepOf(world, f, eatersOf(units));
    const wasStarving = f.starving;
    if (f.resources.food >= need) {
      f.resources.food -= need;
      f.starving = false;
    } else {
      f.resources.food = 0;
      f.starving = need > 0;
    }
    if (f.starving && !wasStarving) logEvent(world, 'health', `${f.name} 糧倉見底，族人開始挨餓！`, f.id);

    for (const u of units) {
      u.hunger = clamp(u.hunger + (f.starving ? HUNGER_RISE : -HUNGER_FALL), 0, 1);
      if (u.hunger > 0.4) u.morale = clamp(u.morale - 0.05, 0, 100);
      if (u.hunger > 0.8) naturalDamage(world, u, STARVE_DAMAGE, 'hunger');
    }
  }
}

/** 疾病：自發染病、近距離傳染、病情惡化與康復 */
export function updateDisease(world: World): void {
  const rng = world.rng;
  const infirmaries = world.buildings.filter((b) => b.type === 'infirmary' && b.complete && b.hp > 0);
  /** 附近有自家醫館時的康復倍率（品質 1 時 ×3） */
  const healMult = (u: Unit) => {
    const b = infirmaries.find(
      (i) => i.factionId === u.factionId && dist(u.x, u.y, centerOf(i).x, centerOf(i).y) <= INFIRMARY_RADIUS,
    );
    return b ? 1 + 2 * b.quality : 1;
  };
  const sickBefore = new Map<number, number>();
  for (const u of world.units) if (u.sick) sickBefore.set(u.factionId, (sickBefore.get(u.factionId) ?? 0) + 1);

  // 傳染：病人身邊的人有機率被感染（不分敵我）
  const sick = world.units.filter((u) => u.sick && u.hp > 0);
  for (const s of sick) {
    for (const u of world.units) {
      if (u.sick || u.hp <= 0 || dist(s.x, s.y, u.x, u.y) > CONTAGION_RADIUS) continue;
      if (rng.chance(CONTAGION_CHANCE * infectionRisk(world, u))) infect(world, u);
    }
  }

  // 自發染病：挨餓時機率大增，有醫館的陣營降低
  for (const u of world.units) {
    if (u.sick || u.hp <= 0) continue;
    const hasInfirmary = infirmaries.some((b) => b.factionId === u.factionId);
    const p = SPONTANEOUS_CHANCE * (1 + 4 * u.hunger) * (hasInfirmary ? 0.6 : 1) * infectionRisk(world, u);
    if (rng.chance(p) && infect(world, u) && !sickBefore.get(u.factionId)) {
      logEvent(world, 'health', `${world.factions[u.factionId].name} 爆發疫病！${unitLabel(u)} 最先倒下`, u.factionId);
      sickBefore.set(u.factionId, 1);
    }
  }

  // 病情：掉血、掉士氣，靠體質與醫館康復
  for (const u of world.units) {
    if (!u.sick || u.hp <= 0) continue;
    u.morale = clamp(u.morale - 0.02, 0, 100);
    naturalDamage(world, u, SICK_DAMAGE, 'disease');
    const p = recoveryRateOf(u.attrs) * healMult(u);
    if (u.hp > 0 && rng.chance(p)) {
      u.sick = false;
      u.immuneUntil = world.tick + IMMUNITY_TICKS;
    }
  }
}

export function infirmaryOf(world: World, factionId: number) {
  return factionBuildings(world, factionId, 'infirmary').find((b) => b.complete);
}
