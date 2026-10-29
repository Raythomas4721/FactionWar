import { buildingCost } from '../buildings';
import { HQ_THREAT_RADIUS, TICKS_PER_SECOND } from '../constants';
import { eatersOf, upkeepOf } from '../systems/health';
import { TROOP_MIX, canTrainTroop, isTroopAvailableToRace } from '../troops';
import { itemDef, itemPower, resolveDef } from '../items';
import { dist } from '../math';
import { RACES } from '../races';
import type { BuildingType, Command, Faction, Role, Troop, Unit, World } from '../types';
import {
  areHostile, canAfford, centerOf, contenders, enemiesNear, factionBuildings, factionUnits, hasCompleted, hqOf, popCapOf,
} from '../util';
import { isBuildingUnlocked } from '../systems/building';
import { pickCraftDef } from '../systems/crafting';
import { unitCost } from '../commands';
import { peaceTicksOf } from '../rules';
import { hasCommonEnemy, raceIsDiplomatic } from '../systems/diplomacy';
import { getTreaty } from '../systems/treaties';
import { activeLairs, guardiansOf } from '../systems/neutral';
import { attackForbidden } from '../modifiers';
import { assignGarrisons, decideOutposts } from '../systems/outposts';

const DIPLOMACY_THINK_TICKS = 600;

/**
 * 陣營策略 AI：每隔一段時間評估局勢，透過指令佇列下達「訓練 / 建造 / 打造 / 進攻」。
 * 玩家的指揮模式之後也會走同一條指令佇列。
 */
export function runFactionAi(world: World, f: Faction): void {
  const units = factionUnits(world, f.id);
  const hq = hqOf(world, f);
  if (!hq) return;
  const hasForge = hasCompleted(world, f.id, 'forge');
  const warriors = units.filter((u) => u.role === 'warrior');
  const cmds: Command[] = [];

  decideDiplomacy(world, f, units, cmds);
  decideStance(world, f, warriors, cmds);
  decideTraining(world, f, units, hasForge, cmds);
  decideBuilding(world, f, units, cmds);
  decideCrafting(f, warriors, hasForge, cmds);
  setGatherWeights(f, hasForge);
  // 據點：AI 自己決定駐守人數，玩家指揮的陣營由玩家決定；兩者都由大臣補人
  if (!f.playerControlled) decideOutposts(world, f, warriors.filter((u) => u.troop !== 'scout').length);
  assignGarrisons(world, f);

  f.commands.push(...cmds);
}

function decideStance(world: World, f: Faction, warriors: Unit[], cmds: Command[]): void {
  const hc = centerOf(hqOf(world, f)!);
  const threatened = enemiesNear(world, f.id, hc.x, hc.y, HQ_THREAT_RADIUS).length >= 2;

  if (f.playerControlled) {
    // 玩家指揮：AI 不改變戰略，只在目標滅亡時自動收兵
    const targetDead = f.targetFaction !== null && !world.factions[f.targetFaction].alive;
    if (f.stance === 'attack' && targetDead) cmds.push({ type: 'setStance', stance: 'defend', target: null });
    return;
  }

  if (f.stance === 'attack') {
    const targetValid =
      f.targetFaction !== null && world.factions[f.targetFaction].alive && areHostile(world, f.id, f.targetFaction);
    // 討伐巢穴時，剩下的巢穴都打不贏就收兵（別去送死給巨龍）
    const lairHopeless = targetValid && world.factions[f.targetFaction!].neutral && pickLairTarget(world, warriors, hc) === null;
    if (warriors.length < 3 || threatened || !targetValid || lairHopeless) {
      cmds.push({ type: 'setStance', stance: 'defend', target: null });
    }
    return;
  }

  if (attackForbidden(world, f)) return;
  // 中立巢穴：兵力是守衛的兩倍以上就去討伐（休戰期也可以）
  const lairTarget = pickLairTarget(world, warriors, hc);
  if (world.tick < peaceTicksOf(world.rules)) {
    if (lairTarget && !threatened) cmds.push({ type: 'setStance', stance: 'attack', target: lairTarget });
    return;
  }
  const armed = warriors.filter((w) => w.weapon).length;
  // 積極程度（難度）越高，越早出兵
  const a = f.aggression;
  const ready =
    (warriors.length >= Math.round(6 / a) && armed >= warriors.length * 0.7) ||
    warriors.length >= Math.round(14 / a) ||
    (world.tick > 9000 / a && warriors.length >= 5) ||
    // 後期決戰：不再等兵力完全集結
    (world.tick > 12000 / a && warriors.length >= 3);
  if (!ready || threatened) return;

  // 挑「兵少又近」的敵人；盟友正在打的對象優先（聯合作戰）
  const allyTargets = new Set(
    world.factions
      .filter((a) => a.alive && a.id !== f.id && getTreaty(world, f.id, a.id) === 'alliance' && a.stance === 'attack')
      .map((a) => a.targetFaction),
  );
  let target: Faction | null = null;
  let bestScore = Infinity;
  for (const e of world.factions) {
    if (e.id === f.id || !e.alive || !areHostile(world, f.id, e.id)) continue;
    const ehq = hqOf(world, e);
    if (!ehq) continue;
    const ec = centerOf(ehq);
    const enemyWarriors = factionUnits(world, e.id).filter((u) => u.role === 'warrior').length;
    const score = enemyWarriors + dist(hc.x, hc.y, ec.x, ec.y) / 8 - (allyTargets.has(e.id) ? 6 : 0);
    if (score < bestScore) {
      bestScore = score;
      target = e;
    }
  }
  // 有打得贏的巢穴時，有時會先去奪寶，而不是直接打其他陣營
  if (lairTarget !== null && (!target || world.rng.chance(0.4))) {
    cmds.push({ type: 'setStance', stance: 'attack', target: lairTarget });
  } else if (target) {
    cmds.push({ type: 'setStance', stance: 'attack', target: target.id });
  }
}

/** 有沒有打得贏的巢穴；有的話回傳中立陣營 id */
function pickLairTarget(world: World, warriors: Unit[], hc: { x: number; y: number }): number | null {
  const beast = world.factions.find((n) => n.neutral && n.alive);
  if (!beast) return null;
  const power = warriors.reduce((s, w) => s + w.hp, 0);
  for (const lair of activeLairs(world)) {
    const guard = guardiansOf(world, lair).reduce((s, g) => s + g.hp, 0);
    const near = dist(hc.x, hc.y, lair.center.x, lair.center.y) < 30;
    if (near && warriors.length >= 6 && power > guard * 2.2) return beast.id;
  }
  return null;
}

/**
 * 外交判斷（玩家指揮的陣營由玩家決定）：
 * 打不過就求和、有共同敵人就結盟、自己夠強又看對方不順眼就撕毀條約。
 */
function decideDiplomacy(world: World, f: Faction, units: Unit[], cmds: Command[]): void {
  // 王國模式是你死我活的對決，沒有外交
  if (f.playerControlled || world.kingdom || RACES[f.race].noDiplomacy || world.tick < f.nextDiplomacyAt) return;
  f.nextDiplomacyAt = world.tick + DIPLOMACY_THINK_TICKS;
  const strength = (id: number) => factionUnits(world, id).filter((u) => u.role === 'warrior').length;
  const mine = strength(f.id);
  const others = contenders(world).filter((o) => o.id !== f.id);
  const enemies = others.filter((o) => areHostile(world, f.id, o.id));
  const partners = others.filter((o) => !areHostile(world, f.id, o.id));

  // 撕毀條約：關係惡劣又打得贏
  for (const p of partners) {
    const limit = getTreaty(world, f.id, p.id) === 'alliance' ? -20 : 0;
    if (f.relations[p.id] < limit && mine > strength(p.id) * 1.3) {
      cmds.push({ type: 'declareWar', target: p.id });
      return;
    }
  }
  // 野心：天下已無敵人、自己兵強馬壯時，有機會對最弱的盟友下手
  if (enemies.length === 0 && partners.length && mine >= 10 && world.rng.chance(0.5)) {
    const weakest = partners.reduce((a, b) => (strength(b.id) < strength(a.id) ? b : a));
    cmds.push({ type: 'declareWar', target: weakest.id });
    return;
  }

  const envoyOut = units.some((u) => u.action.type === 'envoy');
  if (envoyOut || !units.some((u) => u.role === 'diplomat')) return;

  // 求和：對手明顯比我們強，或同時兩線作戰
  const threats = enemies
    .filter((e) => strength(e.id) > mine * 1.3 || enemies.length >= 2)
    .sort((a, b) => strength(b.id) - strength(a.id));
  if (threats.length) {
    cmds.push({ type: 'propose', target: threats[0].id, proposal: 'peace' });
    return;
  }
  // 結盟：和平中的對象，且雙方有共同敵人
  const friend = partners.find(
    (p) => getTreaty(world, f.id, p.id) === 'peace' && f.relations[p.id] > -10 && hasCommonEnemy(world, f.id, p.id),
  );
  if (friend) cmds.push({ type: 'propose', target: friend.id, proposal: 'alliance' });
}

function decideTraining(world: World, f: Faction, units: Unit[], hasForge: boolean, cmds: Command[]): void {
  if (units.length >= popCapOf(world, f.id)) return;
  const count = (r: Role) => units.filter((u) => u.role === r).length;
  const workers = count('worker');
  const warriors = count('warrior');
  const smiths = count('smith');
  const diplomats = count('diplomat');

  let role: Role;
  if (workers < 6) role = 'worker';
  else if (smiths < (hasForge ? 2 : 1)) role = 'smith';
  else if (f.tech >= 1 && !RACES[f.race].noDiplomacy && diplomats < (raceIsDiplomatic(f) ? 2 : 1)) role = 'diplomat';
  else if (workers < 10 && workers < warriors * 0.8) role = 'worker';
  else role = 'warrior';

  const troop = role === 'warrior' ? pickTroop(world, f, units) : 'soldier';
  const reserve = upkeepOf(world, f, eatersOf(units)) * 60 * TICKS_PER_SECOND;
  if (f.resources.food >= unitCost(world, f, role, troop) + reserve) cmds.push({ type: 'train', role, troop });
}

/** 依種族偏好的兵種比例補兵；看到敵方有騎兵就多練長矛兵 */
function pickTroop(world: World, f: Faction, units: Unit[]): Troop {
  const warriors = units.filter((u) => u.role === 'warrior');
  const mix = { ...TROOP_MIX[f.race] };
  const enemyCavalry = world.units.some((u) => u.troop === 'cavalry' && areHostile(world, f.id, u.factionId));
  if (enemyCavalry) mix.spearman = (mix.spearman ?? 0) + 0.1;
  if (f.counterPlay) counterMix(world, f, mix);
  let best: Troop = 'soldier';
  let bestGap = 0;
  for (const [troop, share] of Object.entries(mix) as [Troop, number][]) {
    if (!canTrainTroop(f, troop, (t) => hasCompleted(world, f.id, t))) continue;
    const have = warriors.filter((u) => u.troop === troop).length;
    const gap = share - have / Math.max(1, warriors.length);
    if (gap > bestGap) {
      bestGap = gap;
      best = troop;
    }
  }
  return best;
}

/**
 * 困難 AI：看對手的軍隊組成調整兵種——騎兵多就多練長矛兵，
 * 弓手多就派騎兵衝散（有騎兵的種族）或多練步兵頂上去。
 */
function counterMix(world: World, f: Faction, mix: Partial<Record<Troop, number>>): void {
  const foes = world.units.filter(
    (u) => u.hp > 0 && u.role === 'warrior' && !world.factions[u.factionId].neutral && areHostile(world, f.id, u.factionId),
  );
  if (foes.length < 4) return;
  const share = (pred: (u: Unit) => boolean) => foes.filter(pred).length / foes.length;
  mix.spearman = (mix.spearman ?? 0) + share((u) => u.troop === 'cavalry') * 0.8;
  const ranged = share((u) => !!u.weapon && itemDef(u.weapon).ranged);
  if (ranged > 0.3 && isTroopAvailableToRace('cavalry', f.race)) mix.cavalry = (mix.cavalry ?? 0) + 0.2;
}

function decideBuilding(world: World, f: Faction, units: Unit[], cmds: Command[]): void {
  const pop = units.length;
  const all = factionBuildings(world, f.id);
  const sites = all.filter((b) => !b.complete).length;
  if (sites >= (f.resources.wood > 150 ? 2 : 1)) return;
  const n = (t: BuildingType) => all.filter((b) => b.type === t).length;
  const cap = popCapOf(world, f.id);

  const wishes: BuildingType[] = [];
  if (cap - pop <= 2 && n('house') < 8) wishes.push('house');
  if (f.starving && n('farm') < 8) wishes.push('farm');
  if (n('farm') < Math.min(6, 1 + Math.floor(pop / 6))) wishes.push('farm');
  if (n('infirmary') === 0 && units.some((u) => u.sick)) wishes.push('infirmary');
  if (n('forge') === 0) wishes.push('forge');
  if (n('library') === 0) wishes.push('library');
  if (n('barracks') === 0) wishes.push('barracks');
  if (n('tower') < RACES[f.race].maxTowers) wishes.push('tower');
  if (n('infirmary') === 0 && pop >= 18) wishes.push('infirmary');
  if (n('stable') === 0 && isTroopAvailableToRace('cavalry', f.race)) wishes.push('stable');
  if (n('house') < 8 && pop >= cap - 4) wishes.push('house');

  const pick = wishes.find((t) => isBuildingUnlocked(f, t) && canAfford(f.resources, buildingCost(t, f.race)));
  if (pick) cmds.push({ type: 'build', building: pick });
}

function decideCrafting(f: Faction, warriors: Unit[], hasForge: boolean, cmds: Command[]): void {
  if (f.craftQueue.length >= 2) return;
  const melee = pickCraftDef(f, hasForge, 'weapon', false);
  const ranged = pickCraftDef(f, hasForge, 'weapon', true);
  const armor = pickCraftDef(f, hasForge, 'armor');

  const bestDmg = Math.max(melee?.dmg ?? 0, ranged?.dmg ?? 0);
  const goodEnough = (p: number) => p >= bestDmg * 0.7;
  const weaponsNeeded = warriors.filter((w) => !w.weapon || !goodEnough(itemPower(w.weapon))).length;
  const weaponsInStock = f.armory.filter((i) => itemDef(i).slot === 'weapon' && goodEnough(itemPower(i))).length;
  if (weaponsNeeded > weaponsInStock) {
    const rangedCount = warriors.filter((w) => w.weapon && itemDef(w.weapon).ranged).length;
    const rangersUnarmed = warriors.some((w) => w.troop === 'ranger' && (!w.weapon || !itemDef(w.weapon).ranged));
    const wantRanged =
      rangersUnarmed || warriors.length === 0 || rangedCount / warriors.length < RACES[f.race].rangedShare;
    const def = (wantRanged ? ranged : melee) ?? melee ?? ranged;
    if (def) cmds.push({ type: 'craft', defId: def.id });
    return;
  }

  if (!armor) return;
  const armorNeeded = warriors.filter((w) => !w.armor || itemPower(w.armor) < armor.armor * 0.7).length;
  const armorInStock = f.armory.filter((i) => itemDef(i).slot === 'armor').length;
  const canSpare = armor.cost.food === undefined || f.resources.food > 60;
  if (armorNeeded > armorInStock && canSpare) cmds.push({ type: 'craft', defId: armor.id });
}

/** 資源越缺權重越高；科技與建築決定需要哪些資源 */
function setGatherWeights(f: Faction, hasForge: boolean): void {
  const r = f.resources;
  const metalAge = hasForge || f.tech >= 1;
  const queueNeedsOre = f.craftQueue.some((id) => (resolveDef(f, id)?.cost.ore ?? 0) > 0);
  f.gatherWeights = {
    food: 3 / (r.food / 40 + 1),
    wood: 2 / (r.wood / 60 + 1),
    stone: (metalAge ? 1.5 : 0.4) / (r.stone / 60 + 1),
    ore: (metalAge || queueNeedsOre ? 2 : 0.05) / (r.ore / 40 + 1),
  };
}
