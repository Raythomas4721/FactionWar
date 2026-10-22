import { BUILDING_DEFS } from './buildings';
import {
  AI_INTERVAL, HQ_REST_RADIUS, MANA_MAX, MANA_REGEN, MAP_H, MAP_W, MAX_TECH, TECH_THRESHOLDS,
} from './constants';
import { ITEM_DEFS } from './items';
import { generateMap } from './map';
import { clamp, dist } from './math';
import { RACES, RACE_ORDER, RIVALRY } from './races';
import { Rng } from './rng';
import { maxTicksOf, mergeRules, type WorldRules } from './rules';
import { moraleRegenOf } from './stats';
import type { Faction, Item, RaceId, Role, Unit, World } from './types';
import {
  centerOf, factionBuildings, factionUnits, hqOf, logEvent, spawnUnit,
} from './util';
import { runFactionAi } from './ai/faction';
import { think } from './ai/utility';
import { processCommands } from './commands';
import { attackBuildingTick, attackUnitTick } from './systems/combat';
import { buildTick, createBuilding, updateBuildings } from './systems/building';
import { craftTick } from './systems/crafting';
import { deliverTick, gatherTick } from './systems/economy';
import { equipTick } from './systems/equipment';
import { moveTo } from './systems/movement';

export interface WorldOptions {
  rules?: Partial<WorldRules>;
  width?: number;
  height?: number;
}

const START_ROLES: Role[] = ['worker', 'worker', 'worker', 'worker', 'worker', 'warrior', 'warrior', 'warrior', 'smith'];

/** 沒有陣營、全是草地的世界，給測試用 */
export function createBlankWorld(seed: number, width = MAP_W, height = MAP_H, rules?: Partial<WorldRules>): World {
  const merged = mergeRules(rules);
  return {
    seed,
    tick: 0,
    maxTicks: maxTicksOf(merged),
    rng: new Rng(seed),
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: 'grass' as const, amount: 0 })),
    terrainVersion: 0,
    units: [],
    unitMap: new Map(),
    buildings: [],
    factions: [],
    events: [],
    effects: [],
    nextId: 1,
    over: false,
    winner: null,
    endReason: '',
    rules: merged,
    mana: MANA_MAX / 2,
  };
}

export function createFaction(world: World, race: RaceId, races: RaceId[]): Faction {
  const def = RACES[race];
  const f: Faction = {
    id: world.factions.length,
    race,
    name: def.factionName,
    color: def.color,
    resources: { wood: 60, stone: 20, ore: 0, food: 60 },
    research: TECH_THRESHOLDS[world.rules.startTech] ?? 0,
    tech: world.rules.startTech,
    alive: true,
    eliminatedAt: null,
    stance: 'defend',
    targetFaction: null,
    hqId: -1,
    armory: [],
    craftQueue: [],
    gatherWeights: { food: 3, wood: 2, stone: 0.4, ore: 0.05 },
    commands: [],
    relations: races.map((other) => (other === race ? 100 : RIVALRY[race][other])),
    stats: { kills: 0, deaths: 0, crafted: 0, built: 0, trained: 0, bestItem: null },
    nextAiAt: 1 + world.factions.length * 5,
    playerControlled: false,
  };
  world.factions.push(f);
  return f;
}

export function createWorld(seed: number, opts: WorldOptions = {}): World {
  const world = createBlankWorld(seed, opts.width ?? MAP_W, opts.height ?? MAP_H, opts.rules);
  const map = generateMap(world.rng, world.width, world.height, world.rules.resourceRichness);
  world.tiles = map.tiles;

  const races = world.rng.shuffle([...RACE_ORDER]);
  races.forEach((race, i) => {
    const f = createFaction(world, race, races);
    const spot = map.hqSpots[i];
    f.hqId = createBuilding(world, f, 'hq', spot.x, spot.y, true).id;
    for (const role of START_ROLES) {
      const u = spawnUnit(world, f, role);
      if (u && role === 'warrior') u.weapon = starterWeapon(world, race);
    }
  });
  logEvent(world, 'info', `新的戰局開始（種子 ${seed}）`);
  return world;
}

function starterWeapon(world: World, race: RaceId): Item {
  return { id: world.nextId++, defId: race === 'elf' ? 'shortbow' : 'club', quality: 1, maker: '初始配給' };
}

export function score(world: World, f: Faction): number {
  if (!f.alive) return 0;
  return (
    factionUnits(world, f.id).length * 10 +
    factionBuildings(world, f.id).filter((b) => b.complete).length * 15 +
    f.tech * 30 +
    f.stats.kills * 5
  );
}

/** 推進模擬一個 tick */
export function step(world: World): void {
  if (world.over) return;
  world.tick++;
  world.maxTicks = maxTicksOf(world.rules);
  world.mana = world.rules.infiniteMana ? MANA_MAX : Math.min(MANA_MAX, world.mana + MANA_REGEN);

  for (const f of world.factions) {
    if (!f.alive) continue;
    if (world.tick >= f.nextAiAt) {
      runFactionAi(world, f);
      f.nextAiAt = world.tick + AI_INTERVAL;
    }
    processCommands(world, f);
  }

  updateResearch(world);
  updateBuildings(world);

  for (const u of world.units) {
    if (u.hp <= 0) continue;
    if (u.cooldown > 0) u.cooldown--;
    if (world.tick >= u.thinkAt) {
      think(world, u);
      u.thinkAt = world.tick + 6 + (u.id % 4);
    }
    if (!act(world, u)) {
      u.action = { type: 'idle' };
      u.thinkAt = world.tick + 1;
    }
    recover(world, u);
  }

  cleanup(world);
  for (const e of world.effects) e.ttl--;
  world.effects = world.effects.filter((e) => e.ttl > 0);
  checkVictory(world);
}

function act(world: World, u: Unit): boolean {
  const a = u.action;
  switch (a.type) {
    case 'idle': return true;
    case 'gather': return gatherTick(world, u, a.kind, a.tx, a.ty);
    case 'deliver': return deliverTick(world, u);
    case 'build': return buildTick(world, u, a.buildingId);
    case 'craft': return craftTick(world, u);
    case 'attackUnit': return attackUnitTick(world, u, a.targetId);
    case 'attackBuilding': return attackBuildingTick(world, u, a.targetId);
    case 'equip': return equipTick(world, u);
    case 'guard':
      moveTo(world, u, a.x, a.y, 0.5);
      return true;
    case 'retreat': {
      const hq = hqOf(world, world.factions[u.factionId]);
      if (!hq) return false;
      const c = centerOf(hq);
      moveTo(world, u, c.x, c.y, HQ_REST_RADIUS - 1);
      return true;
    }
  }
}

/** 士氣自然回復；在自家營帳旁會治療傷勢 */
function recover(world: World, u: Unit): void {
  u.morale = clamp(u.morale + moraleRegenOf(u.attrs), 0, 100);
  const hq = hqOf(world, world.factions[u.factionId]);
  if (hq) {
    const c = centerOf(hq);
    if (dist(u.x, u.y, c.x, c.y) <= HQ_REST_RADIUS) {
      u.hp = Math.min(u.maxHp, u.hp + 0.06 + u.attrs.con * 0.006);
      u.morale = clamp(u.morale + 0.4, 0, 100);
    }
  }
}

/** 研究點數來自非戰鬥人員的智慧總和，書院加成 */
function updateResearch(world: World): void {
  for (const f of world.factions) {
    if (!f.alive || f.tech >= MAX_TECH) continue;
    let intSum = 0;
    for (const u of world.units) if (u.factionId === f.id && u.hp > 0 && u.role !== 'warrior') intSum += u.attrs.int;
    const libraries = factionBuildings(world, f.id, 'library').filter((b) => b.complete).length;
    f.research += 0.004 * intSum * (1 + RACES[f.race].libraryBonus * libraries) * world.rules.researchMult;
    while (f.tech < MAX_TECH && f.research >= TECH_THRESHOLDS[f.tech + 1]) {
      f.tech++;
      logEvent(world, 'tech', `${f.name} 科技提升到 Lv${f.tech}，解鎖：${unlocksAt(f, f.tech)}`, f.id);
    }
  }
}

export function unlocksAt(f: Faction, tech: number): string {
  const items = Object.values(ITEM_DEFS)
    .filter((d) => d.tech === tech && (!d.onlyRace || d.onlyRace === f.race))
    .map((d) => d.name);
  const buildings = Object.values(BUILDING_DEFS).filter((d) => d.tech === tech && d.type !== 'hq').map((d) => d.name);
  return [...buildings, ...items].join('、') || '（無）';
}

function cleanup(world: World): void {
  if (world.units.some((u) => u.hp <= 0)) {
    world.units = world.units.filter((u) => {
      if (u.hp > 0) return true;
      world.unitMap.delete(u.id);
      return false;
    });
  }
  if (world.buildings.some((b) => b.hp <= 0)) {
    world.buildings = world.buildings.filter((b) => b.hp > 0);
  }
}

function checkVictory(world: World): void {
  const alive = world.factions.filter((f) => f.alive);
  if (alive.length <= 1) {
    world.over = true;
    world.winner = alive[0]?.id ?? null;
    world.endReason = alive[0] ? `${alive[0].name} 統一了大陸！` : '同歸於盡';
  } else if (world.tick >= world.maxTicks) {
    world.over = true;
    const best = alive.reduce((a, b) => (score(world, b) > score(world, a) ? b : a));
    world.winner = best.id;
    world.endReason = `時間到，${best.name} 以最高分勝出`;
  }
  if (world.over) logEvent(world, 'faction', `戰局結束：${world.endReason}`, world.winner ?? -1);
}
