import { BUILDING_DEFS } from './buildings';
import {
  AI_INTERVAL, HQ_REST_RADIUS, MANA_MAX, MANA_REGEN, MAP_H, MAP_W, MAX_TECH, TECH_THRESHOLDS,
} from './constants';
import { ITEM_DEFS } from './items';
import { DUEL_H, DUEL_W, generateDuelMap, generateMap } from './map';
import { clamp, dist } from './math';
import { RACES, RACE_ORDER, RIVALRY } from './races';
import { Rng } from './rng';
import { maxTicksOf, mergeRules, type WorldRules } from './rules';
import { moraleRegenOf } from './stats';
import type { Faction, Item, RaceId, Role, Unit, World } from './types';
import {
  centerOf, contenders, enemiesNear, factionBuildings, factionUnits, hqOf, logEvent, spawnUnit,
} from './util';
import { runFactionAi } from './ai/faction';
import { think } from './ai/utility';
import { processCommands } from './commands';
import { attackBuildingTick, attackUnitTick } from './systems/combat';
import { buildTick, createBuilding, updateBuildings } from './systems/building';
import { craftTick } from './systems/crafting';
import { deliverTick, gatherTick, updateRegrowth } from './systems/economy';
import { equipTick } from './systems/equipment';
import { infirmaryOf, updateAging, updateDisease, updateHunger } from './systems/health';
import { envoyTick, isAllianceVictory, subvertTick, updateDiplomacy, updateLoyalty } from './systems/diplomacy';
import { initTreaties } from './systems/treaties';
import { guardianRegen, guardianThink, hasRelic, setupLairs } from './systems/neutral';
import { updateHeroes } from './systems/heroSystem';
import { updateWorldEvents } from './events';
import { evaluateTrial } from './trials';
import { updateKingdom } from './policies';
import { modOf } from './modifiers';
import { createOutposts, updateOutposts } from './systems/outposts';
import { updateFog } from './fog';
import { ambushTick, garrisonTick, tunnelTick, updateStealth } from './systems/troopActions';
import { moveTo } from './systems/movement';
import { DEFAULT_TACTICS, updateTactics } from './tactics';

export interface WorldOptions {
  rules?: Partial<WorldRules>;
  width?: number;
  height?: number;
  /** 1v1 對峙地圖（左右兩端各一個營帳） */
  duel?: boolean;
  /** 依序指定參戰種族（不洗牌，可以讓同一位置固定是玩家） */
  races?: RaceId[];
}

/** 全員結盟要維持多久才算共治勝利（5 分鐘） */
export const ALLIANCE_HOLD_TICKS = 3000;

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
    treaties: [],
    truceUntil: [],
    allianceSince: null,
    mana: MANA_MAX / 2,
    lairs: [],
    legends: [],
    activeEvents: [],
    nextEventAt: 0,
    shake: 0,
    outposts: [],
    tunnels: [],
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
    blueprints: [],
    gatherWeights: { food: 3, wood: 2, stone: 0.4, ore: 0.05 },
    commands: [],
    relations: races.map((other) => (other === race ? 100 : RIVALRY[race][other])),
    stats: {
      kills: 0, deaths: 0, crafted: 0, built: 0, trained: 0,
      infections: 0, diseaseDeaths: 0, starved: 0, recruited: 0, defected: 0, treaties: 0, inventions: 0, heroes: 0, revenges: 0, bestItem: null,
    },
    nextAiAt: 1 + world.factions.length * 5,
    nextDiplomacyAt: 600 + world.factions.length * 50,
    playerControlled: false,
    starving: false,
    neutral: race === 'beast',
    relics: [],
    fallReason: null,
    nemeses: [],
    attrBonus: { str: 0, agi: 0, int: 0, con: 0, cha: 0 },
    modifiers: [],
    aggression: 1,
    counterPlay: false,
    garrisons: {},
    tactics: { ...DEFAULT_TACTICS },
    abilityReadyAt: {},
    musterAt: null,
    recallUntil: 0,
    useAbilities: false,
  };
  world.factions.push(f);
  return f;
}

export function createWorld(seed: number, opts: WorldOptions = {}): World {
  const width = opts.width ?? (opts.duel ? DUEL_W : MAP_W);
  const height = opts.height ?? (opts.duel ? DUEL_H : MAP_H);
  const world = createBlankWorld(seed, width, height, opts.rules);
  const richness = world.rules.resourceRichness;
  const map = opts.duel ? generateDuelMap(world.rng, width, height, richness) : generateMap(world.rng, width, height, richness);
  world.tiles = map.tiles;

  const races = opts.races?.slice(0, map.hqSpots.length) ?? pickRaces(world, map.hqSpots.length);
  races.forEach((race, i) => {
    const f = createFaction(world, race, races);
    const spot = map.hqSpots[i];
    f.hqId = createBuilding(world, f, 'hq', spot.x, spot.y, true).id;
    if (opts.duel && i === 1) f.mirrored = true;
    for (const role of START_ROLES) {
      const u = spawnUnit(world, f, role);
      if (u && role === 'warrior') u.weapon = starterWeapon(world, race);
    }
  });
  if (map.outpostSpots) createOutposts(world, map.outpostSpots);
  world.tunnels = (map.tunnelSpots ?? []).map((t, i) => ({ id: i + 1, a: t.a, b: t.b }));
  if (world.rules.neutralLairs) {
    const beast = createFaction(world, 'beast', [...races, 'beast']);
    setupLairs(world, beast, map, (x, y) => createBuilding(world, beast, 'lair', x, y, true).id);
  }
  initTreaties(world);
  logEvent(world, 'info', `新的戰局開始（種子 ${seed}）`);
  return world;
}

/** 世界法則指定的種族優先，不足的從其他種族隨機補上 */
function pickRaces(world: World, count: number): RaceId[] {
  const chosen = [...new Set(world.rules.raceSelection)].filter((r) => RACE_ORDER.includes(r)).slice(0, count);
  const rest = world.rng.shuffle(RACE_ORDER.filter((r) => !chosen.includes(r)));
  return world.rng.shuffle([...chosen, ...rest.slice(0, count - chosen.length)]);
}

function starterWeapon(world: World, race: RaceId): Item {
  return { id: world.nextId++, defId: race === 'elf' ? 'shortbow' : 'club', quality: 1, maker: '初始配給' };
}

export function score(world: World, f: Faction): number {
  if (!f.alive) return 0;
  return (
    factionUnits(world, f.id).length * 10 +
    factionBuildings(world, f.id).filter((b) => b.complete).length * 8 +
    f.tech * 30 +
    f.stats.kills * 3 +
    world.outposts.filter((o) => o.owner === f.id).length * 15
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
    if (world.tick >= f.nextAiAt && !f.neutral) {
      runFactionAi(world, f);
      f.nextAiAt = world.tick + AI_INTERVAL;
    }
    processCommands(world, f);
  }

  updateResearch(world);
  updateBuildings(world);
  updateRegrowth(world);
  updateHunger(world);
  updateDisease(world);
  updateAging(world);
  updateLoyalty(world);
  updateStealth(world);
  updateHeroes(world);
  updateWorldEvents(world);
  updateKingdom(world);
  updateTactics(world);
  updateDiplomacy(world);

  const besieged = new Set<number>();
  for (const f of world.factions) {
    const hq = f.alive ? hqOf(world, f) : undefined;
    if (!hq) continue;
    const c = centerOf(hq);
    if (enemiesNear(world, f.id, c.x, c.y, HQ_REST_RADIUS + 3).length) besieged.add(f.id);
  }

  // 每個 tick 輪流從頭、從尾處理小人，先出手的優勢不會一直落在同一個陣營
  const n = world.units.length;
  for (let k = 0; k < n; k++) {
    const u = world.units[world.tick % 2 ? n - 1 - k : k];
    if (u.hp <= 0) continue;
    if (u.cooldown > 0) u.cooldown--;
    if (world.tick >= u.thinkAt) {
      if (u.monster) guardianThink(world, u);
      else if (!u.hero?.possessed) think(world, u);
      u.thinkAt = world.tick + 6 + (u.id % 4);
    }
    if (!act(world, u)) {
      u.action = { type: 'idle' };
      u.thinkAt = world.tick + 1;
    }
    if (u.monster) guardianRegen(world, u);
    else recover(world, u, besieged);
  }

  updateOutposts(world);
  cleanup(world);
  updateFog(world);
  for (const e of world.effects) e.ttl--;
  world.shake = Math.max(0, world.shake - 0.4);
  world.effects = world.effects.filter((e) => e.ttl > 0);
  checkVictory(world);
  evaluateTrial(world);
}

function act(world: World, u: Unit): boolean {
  // 還在古地道裡，什麼都做不了
  if (world.tick < u.surfaceAt) return true;
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
    case 'envoy': return envoyTick(world, u);
    case 'subvert': return subvertTick(world, u, a.targetId);
    case 'tunnel': return tunnelTick(world, u, a.targetId);
    case 'ambush': return ambushTick(world, u, a.x, a.y);
    case 'guard':
      moveTo(world, u, a.x, a.y, 0.5);
      return true;
    case 'garrison': {
      const o = world.outposts.find((p) => p.id === a.outpostId);
      if (!o || u.post !== o.id) return false;
      garrisonTick(world, u, o);
      return true;
    }
    case 'scout':
      // 到了就重新決定下一個偵察地點
      return !moveTo(world, u, a.x, a.y, 0.8);
    case 'retreat': {
      // 病人去醫館養病，其他人回營帳
      const hq = hqOf(world, world.factions[u.factionId]);
      if (!hq) return false;
      const infirmary = u.sick ? infirmaryOf(world, u.factionId) : undefined;
      const c = centerOf(infirmary ?? hq);
      moveTo(world, u, c.x, c.y, infirmary ? 2 : HQ_REST_RADIUS - 1);
      return true;
    }
  }
}

/** 士氣自然回復；在自家營帳旁會治療傷勢（營帳被圍攻時無法休養） */
function recover(world: World, u: Unit, besieged: Set<number>): void {
  u.morale = RACES[u.race].fearless ? 100 : clamp(u.morale + moraleRegenOf(u.attrs), 0, 100);
  const hq = hqOf(world, world.factions[u.factionId]);
  if (hq && !besieged.has(u.factionId)) {
    const c = centerOf(hq);
    if (dist(u.x, u.y, c.x, c.y) <= HQ_REST_RADIUS) {
      // 病人在營帳只能休息，傷勢要等病好（或去醫館）才會恢復
      const heal = (0.06 + u.attrs.con * 0.006) * (hasRelic(world, u.factionId, 'vitality') ? 2 : 1);
      if (!u.sick) u.hp = Math.min(u.maxHp, u.hp + heal);
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
    // 書院的效果隨建築品質增減
    const libraries = factionBuildings(world, f.id, 'library')
      .filter((b) => b.complete)
      .reduce((s, b) => s + b.quality, 0);
    const wisdom = hasRelic(world, f.id, 'wisdom') ? 1.5 : 1;
    f.research += 0.004 * intSum * (1 + RACES[f.race].libraryBonus * libraries) * world.rules.researchMult * wisdom * modOf(world, f.id, 'research');
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
  const alive = contenders(world);
  if (isAllianceVictory(world)) {
    if (world.allianceSince === null) {
      world.allianceSince = world.tick;
      logEvent(world, 'diplomacy', '天下諸國全數結盟！若同盟維持 5 分鐘，將共治大陸', -1);
    }
  } else if (world.allianceSince !== null) {
    world.allianceSince = null;
    logEvent(world, 'diplomacy', '同盟破裂，共治之夢落空', -1);
  }

  if (world.allianceSince !== null && world.tick - world.allianceSince >= ALLIANCE_HOLD_TICKS) {
    world.over = true;
    const leader = alive.reduce((a, b) => (score(world, b) > score(world, a) ? b : a));
    world.winner = leader.id;
    world.endReason = `${alive.map((f) => f.name).join('、')} 結盟共治大陸（盟主：${leader.name}）`;
  } else if (alive.length <= 1) {
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
