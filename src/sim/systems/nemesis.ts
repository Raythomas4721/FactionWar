import { dist } from '../math';
import type { Nemesis, Unit, World } from '../types';
import { logEvent, unitLabel } from '../util';
import { MAX_HEROES } from '../heroes';
import { choosePath, floatText, gainXp, heroLabel, heroesOf, promote } from './heroSystem';

/**
 * 宿敵系統：殺死某陣營英雄的敵人，會成為那個陣營的宿敵。
 * 宿敵會累積仇恨值；親手擊敗宿敵就是「復仇」。
 */

/** 仇恨值：殺英雄 +50、殺一般族人 +2 */
const GRUDGE_HERO = 50;
const GRUDGE_UNIT = 2;
/** 復仇時復仇者額外獲得的經驗 */
const REVENGE_XP = 50;

/** factionId 陣營記恨的宿敵中，有沒有 unitId 這個人 */
export function nemesisOf(world: World, factionId: number, unitId: number): Nemesis | undefined {
  return world.factions[factionId]?.nemeses.find((n) => n.unitId === unitId);
}

/** 這個單位是哪些陣營的宿敵 */
export function nemesisRecords(world: World, unitId: number): { factionId: number; nemesis: Nemesis }[] {
  const out: { factionId: number; nemesis: Nemesis }[] = [];
  for (const f of world.factions) {
    const n = f.nemeses.find((x) => x.unitId === unitId);
    if (n) out.push({ factionId: f.id, nemesis: n });
  }
  return out;
}

/** 有人被殺時呼叫：處理復仇、仇恨累積、產生新的宿敵 */
export function onNemesisKill(world: World, killer: Unit, victim: Unit): void {
  // 召喚物的擊殺算在召喚者頭上；怪物不參與宿敵系統
  const owner = killer.summonedBy !== undefined ? world.unitMap.get(killer.summonedBy) ?? killer : killer;
  if (owner.monster || owner.hp <= 0 || owner.factionId === victim.factionId) return;

  // 1. 殺死的是自己陣營的宿敵 → 復仇
  const grudgeAgainstVictim = nemesisOf(world, owner.factionId, victim.id);
  if (grudgeAgainstVictim) revenge(world, owner, victim, grudgeAgainstVictim);

  // 2. 兇手原本就是對方的宿敵 → 仇恨加深
  const existing = nemesisOf(world, victim.factionId, owner.id);
  if (existing) {
    existing.grudge += victim.hero ? GRUDGE_HERO : GRUDGE_UNIT;
    if (victim.hero) existing.victims.push(heroLabel(victim));
    return;
  }

  // 3. 殺死了英雄 → 成為對方的宿敵（無名小卒會一戰成名，晉升英雄）
  if (!victim.hero) return;
  const victimFaction = world.factions[victim.factionId];
  if (!owner.hero && owner.role === 'warrior' && heroesOf(world, owner.factionId).length < MAX_HEROES) {
    promote(world, owner, choosePath(world, owner));
    logEvent(world, 'hero', `⭐ 無名小卒 ${owner.name} 擊殺英雄 ${heroLabel(victim)}，一戰成名！`, owner.factionId);
  }
  victimFaction.nemeses.push({
    unitId: owner.id,
    factionId: owner.factionId,
    name: owner.hero ? heroLabel(owner) : unitLabel(owner),
    grudge: GRUDGE_HERO,
    victims: [heroLabel(victim)],
    since: world.tick,
  });
  floatText(world, owner.x, owner.y - 1.2, '宿敵誕生', '#ff4d4d', 13, 24);
  logEvent(world, 'hero', `☠ ${unitLabel(owner)} 殺死了 ${heroLabel(victim)}，成為 ${victimFaction.name} 的宿敵！`, victim.factionId);
}

function revenge(world: World, avenger: Unit, nemesisUnit: Unit, record: Nemesis): void {
  const f = world.factions[avenger.factionId];
  f.nemeses = f.nemeses.filter((n) => n !== record);
  f.stats.revenges++;
  if (avenger.hero) {
    gainXp(world, avenger, REVENGE_XP);
    if (!avenger.hero.title.includes('復仇者')) avenger.hero.title = `${avenger.hero.title}·復仇者`;
    avenger.hero.deeds.push(`${Math.floor(world.tick / 600)} 分：手刃宿敵 ${record.name}`);
  }
  // 復仇讓附近的族人士氣大振
  for (const a of world.units) {
    if (a.hp > 0 && a.factionId === f.id && dist(a.x, a.y, avenger.x, avenger.y) <= 8) a.morale = 100;
  }
  floatText(world, nemesisUnit.x, nemesisUnit.y - 1.2, '復仇！', '#ff4d4d', 18, 28);
  logEvent(
    world,
    'hero',
    `⚔ 復仇！${unitLabel(avenger)} 擊敗了宿敵 ${record.name}（仇恨 ${record.grudge}，曾殺死 ${record.victims.join('、')}）`,
    f.id,
  );
}

/** 宿敵死於別的原因（疫病、他國、天災）時，從仇恨名單移除 */
export function forgetNemesis(world: World, unitId: number): void {
  for (const f of world.factions) {
    if (f.nemeses.some((n) => n.unitId === unitId)) f.nemeses = f.nemeses.filter((n) => n.unitId !== unitId);
  }
}

/** 附身的英雄靠近自家宿敵時提醒一次（每 30 秒最多一次） */
export function nemesisAlert(world: World, hero: Unit): void {
  const h = hero.hero;
  if (!h || world.tick - h.nemesisAlertAt < 300) return;
  const f = world.factions[hero.factionId];
  for (const n of f.nemeses) {
    const u = world.unitMap.get(n.unitId);
    if (!u || u.hp <= 0 || dist(u.x, u.y, hero.x, hero.y) > 9) continue;
    h.nemesisAlertAt = world.tick;
    floatText(world, u.x, u.y - 1.4, '宿敵！', '#ff4d4d', 15, 24);
    logEvent(world, 'hero', `⚠ 宿敵 ${n.name} 出現在 ${heroLabel(hero)} 附近！（仇恨 ${n.grudge}）`, hero.factionId);
    return;
  }
}
