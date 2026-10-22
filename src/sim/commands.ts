import { BARRACKS_DISCOUNT } from './buildings';
import { resolveDef } from './items';
import { RACES } from './races';
import { TROOP_DEFS, canTrainTroop } from './troops';
import type { Command, Faction, Role, Troop, World } from './types';
import { areHostile, hasCompleted, logEvent, popCapOf, popOf, spawnUnit } from './util';
import { declareWar, sendEnvoy } from './systems/diplomacy';
import { getTreaty } from './systems/treaties';
import { placeBuilding } from './systems/building';

const MAX_CRAFT_QUEUE = 4;

/** 下指令的唯一入口：AI 與（未來的）玩家指揮模式共用 */
export function issueCommand(world: World, factionId: number, cmd: Command): void {
  world.factions[factionId]?.commands.push(cmd);
}

export function unitCost(world: World, f: Faction, role: Role, troop: Troop = 'soldier'): number {
  const base = RACES[f.race].unitCost;
  if (role !== 'warrior') return base;
  const discounted = hasCompleted(world, f.id, 'barracks') ? Math.round(base * BARRACKS_DISCOUNT) : base;
  return discounted + TROOP_DEFS[troop].extraFood;
}

export function processCommands(world: World, f: Faction): void {
  const cmds = f.commands;
  f.commands = [];
  for (const cmd of cmds) {
    switch (cmd.type) {
      case 'train': {
        const troop = cmd.role === 'warrior' ? cmd.troop ?? 'soldier' : 'soldier';
        if (!canTrainTroop(f, troop, (t) => hasCompleted(world, f.id, t))) break;
        const cost = unitCost(world, f, cmd.role, troop);
        if (f.resources.food < cost || popOf(world, f.id) >= popCapOf(world, f.id)) break;
        if (spawnUnit(world, f, cmd.role, troop)) {
          f.resources.food -= cost;
          f.stats.trained++;
        }
        break;
      }
      case 'build':
        placeBuilding(world, f, cmd.building);
        break;
      case 'craft':
        if (resolveDef(f, cmd.defId) && f.craftQueue.length < MAX_CRAFT_QUEUE) f.craftQueue.push(cmd.defId);
        break;
      case 'propose': {
        const t = getTreaty(world, f.id, cmd.target);
        const pointless = cmd.proposal === 'peace' ? t !== 'war' : t !== 'peace';
        if (pointless || !world.factions[cmd.target]?.alive) break;
        if (!sendEnvoy(world, f, cmd.target, cmd.proposal) && f.playerControlled) {
          logEvent(world, 'info', `${f.name} 沒有空閒的外交官可以派遣（先訓練外交官）`, f.id);
        }
        break;
      }
      case 'declareWar':
        declareWar(world, f, cmd.target);
        break;
      case 'setStance': {
        // 對和平或同盟的對象下令進攻，等於撕毀條約
        if (cmd.stance === 'attack' && cmd.target !== null && !areHostile(world, f.id, cmd.target)) {
          declareWar(world, f, cmd.target);
        }
        if (cmd.stance === f.stance && cmd.target === f.targetFaction) break;
        f.stance = cmd.stance;
        f.targetFaction = cmd.target;
        if (cmd.stance === 'attack' && cmd.target !== null) {
          const n = world.units.filter((u) => u.factionId === f.id && u.role === 'warrior' && u.hp > 0).length;
          logEvent(world, 'faction', `${f.name} 集結 ${n} 名戰士，向 ${world.factions[cmd.target].name} 發動進攻！`, f.id);
        } else {
          logEvent(world, 'faction', `${f.name} 收兵回防`, f.id);
        }
        break;
      }
    }
  }
}
