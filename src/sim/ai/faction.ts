import { buildingCost } from '../buildings';
import { HQ_THREAT_RADIUS, TICKS_PER_SECOND } from '../constants';
import { upkeepOf } from '../systems/health';
import { ITEM_DEFS, itemPower } from '../items';
import { dist } from '../math';
import { RACES } from '../races';
import type { BuildingType, Command, Faction, Role, Unit, World } from '../types';
import {
  canAfford, centerOf, enemiesNear, factionBuildings, factionUnits, hasCompleted, hqOf, popCapOf,
} from '../util';
import { isBuildingUnlocked } from '../systems/building';
import { pickCraftDef } from '../systems/crafting';
import { unitCost } from '../commands';
import { peaceTicksOf } from '../rules';

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

  decideStance(world, f, warriors, cmds);
  decideTraining(world, f, units, hasForge, cmds);
  decideBuilding(world, f, units, cmds);
  decideCrafting(f, warriors, hasForge, cmds);
  setGatherWeights(f, hasForge);

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
    const targetAlive = f.targetFaction !== null && world.factions[f.targetFaction].alive;
    if (warriors.length < 3 || threatened || !targetAlive) {
      cmds.push({ type: 'setStance', stance: 'defend', target: null });
    }
    return;
  }

  if (world.tick < peaceTicksOf(world.rules)) return;
  const armed = warriors.filter((w) => w.weapon).length;
  const ready =
    (warriors.length >= 6 && armed >= warriors.length * 0.7) ||
    warriors.length >= 14 ||
    (world.tick > 9000 && warriors.length >= 5) ||
    // 後期決戰：不再等兵力完全集結
    (world.tick > 12000 && warriors.length >= 3);
  if (!ready || threatened) return;

  // 挑「兵少又近」的敵人
  let target: Faction | null = null;
  let bestScore = Infinity;
  for (const e of world.factions) {
    if (e.id === f.id || !e.alive) continue;
    const ehq = hqOf(world, e);
    if (!ehq) continue;
    const ec = centerOf(ehq);
    const enemyWarriors = factionUnits(world, e.id).filter((u) => u.role === 'warrior').length;
    const score = enemyWarriors + dist(hc.x, hc.y, ec.x, ec.y) / 8;
    if (score < bestScore) {
      bestScore = score;
      target = e;
    }
  }
  if (target) cmds.push({ type: 'setStance', stance: 'attack', target: target.id });
}

function decideTraining(world: World, f: Faction, units: Unit[], hasForge: boolean, cmds: Command[]): void {
  if (units.length >= popCapOf(world, f.id)) return;
  const count = (r: Role) => units.filter((u) => u.role === r).length;
  const workers = count('worker');
  const warriors = count('warrior');
  const smiths = count('smith');

  let role: Role;
  if (workers < 6) role = 'worker';
  else if (smiths < (hasForge ? 2 : 1)) role = 'smith';
  else if (workers < 10 && workers < warriors * 0.8) role = 'worker';
  else role = 'warrior';

  const reserve = upkeepOf(world, f, units.length) * 60 * TICKS_PER_SECOND;
  if (f.resources.food >= unitCost(world, f, role) + reserve) cmds.push({ type: 'train', role });
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
  const weaponsInStock = f.armory.filter((i) => ITEM_DEFS[i.defId].slot === 'weapon' && goodEnough(itemPower(i))).length;
  if (weaponsNeeded > weaponsInStock) {
    const rangedCount = warriors.filter((w) => w.weapon && ITEM_DEFS[w.weapon.defId].ranged).length;
    const wantRanged = warriors.length === 0 || rangedCount / warriors.length < RACES[f.race].rangedShare;
    const def = (wantRanged ? ranged : melee) ?? melee ?? ranged;
    if (def) cmds.push({ type: 'craft', defId: def.id });
    return;
  }

  if (!armor) return;
  const armorNeeded = warriors.filter((w) => !w.armor || itemPower(w.armor) < armor.armor * 0.7).length;
  const armorInStock = f.armory.filter((i) => ITEM_DEFS[i.defId].slot === 'armor').length;
  const canSpare = armor.cost.food === undefined || f.resources.food > 60;
  if (armorNeeded > armorInStock && canSpare) cmds.push({ type: 'craft', defId: armor.id });
}

/** 資源越缺權重越高；科技與建築決定需要哪些資源 */
function setGatherWeights(f: Faction, hasForge: boolean): void {
  const r = f.resources;
  const metalAge = hasForge || f.tech >= 1;
  const queueNeedsOre = f.craftQueue.some((id) => (ITEM_DEFS[id].cost.ore ?? 0) > 0);
  f.gatherWeights = {
    food: 3 / (r.food / 40 + 1),
    wood: 2 / (r.wood / 60 + 1),
    stone: (metalAge ? 1.5 : 0.4) / (r.stone / 60 + 1),
    ore: (metalAge || queueNeedsOre ? 2 : 0.05) / (r.ore / 40 + 1),
  };
}
