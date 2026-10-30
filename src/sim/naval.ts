import { TICKS_PER_SECOND } from './constants';
import { dist } from './math';
import { TROOP_DEFS, canTrainTroop } from './troops';
import type { ItemDef } from './items';
import type { Faction, Point, Troop, Unit, UnitAction, World } from './types';
import {
  areHostile, canAfford, centerOf, factionBuildings, hasCompleted, isTargetable, logEvent, pay, popCapOf, popOf,
  spawnUnit, unitLabel,
} from './util';
import { handleDeath } from './systems/combat';
import { findPath, moveTo } from './systems/movement';
import { dockWater, docksOf, isNaval, landingSea, nearestSeaTile, shoreBeside } from './sea';

/**
 * 海軍：碼頭造船、戰船護航與轟擊、運兵船渡海登陸。
 * 登陸作戰由陣營統籌（updateNaval）：在碼頭集合一隊戰士上船，開到敵方海岸搶灘，再回港等下一趟。
 */

export const SHIP_HP: Partial<Record<Troop, number>> = { transport: 140, warship: 190 };
export const SHIP_SIGHT = 9;
/** 運兵船一次載幾個人 */
export const TRANSPORT_CAPACITY = 6;
/** 戰船的弩砲射程 */
const BALLISTA_RANGE = 5.5;
const BALLISTA: ItemDef = {
  id: 'naval:ballista', name: '船弩', slot: 'weapon', ranged: true, dmg: 11, range: BALLISTA_RANGE, armor: 0,
  cost: {}, tech: 99, needsForge: false, affinity: [], inventor: '造船匠',
};
const SHIP_NAMES = ['海燕', '破浪', '長風', '怒濤', '鯨歌', '晨星', '赤帆', '銀鷗', '潮聲', '遠航', '鐵錨', '流雲'];
/** 等人上船最多等多久 */
const BOARD_SECONDS = 30;
/** 兩次登陸作戰之間的間隔 */
const LANDING_COOLDOWN = 20 * TICKS_PER_SECOND;
/** 離碼頭太遠的戰士不叫回來上船 */
const BOARD_RADIUS = 26;
/** 在碼頭旁邊修船的速度（每秒） */
const DOCK_REPAIR = 4;

/** 在碼頭造船：用木頭與鐵礦，船從碼頭旁的海面下水 */
export function trainShip(world: World, f: Faction, troop: Troop): Unit | null {
  const def = TROOP_DEFS[troop];
  if (!def.naval || !canTrainTroop(f, troop, (t) => hasCompleted(world, f.id, t))) return null;
  const cost = def.cost ?? {};
  if (!canAfford(f.resources, cost) || popOf(world, f.id) >= popCapOf(world, f.id)) return null;
  const dock = docksOf(world, f.id)[0];
  const water = dock && dockWater(world, dock);
  if (!water) return null;
  const u = spawnUnit(world, f, 'warrior', troop, { x: water.x + 0.5, y: water.y + 0.5 });
  if (!u) return null;
  pay(f.resources, cost);
  f.stats.trained++;
  u.hp = u.maxHp = SHIP_HP[troop] ?? 150;
  u.morale = 100;
  u.name = `「${SHIP_NAMES[u.id % SHIP_NAMES.length]}號」`;
  u.weapon = troop === 'warship' ? { id: world.nextId++, defId: BALLISTA.id, quality: 1, maker: '造船匠', custom: BALLISTA } : null;
  logEvent(world, 'build', `${f.name} 的${def.name}${u.name}下水了`, f.id);
  return u;
}

/** 看得到、而且打得到的敵人（船只打得到靠海的目標） */
function shipCanReach(world: World, e: Unit): boolean {
  return isNaval(e) || !!nearestSeaTile(world, e.x, e.y, BALLISTA_RANGE - 0.5);
}

/**
 * 船的決策：運兵船聽從登陸作戰的安排、平時在碼頭待命；
 * 戰船受傷回港修理，看到打得到的敵人就開火，進攻時轟擊敵方海邊的建築，平時在港口巡邏。
 */
export function shipDecision(world: World, u: Unit): UnitAction {
  const f = world.factions[u.factionId];
  const dock = docksOf(world, f.id)[0];
  const home = dock ? dockWater(world, dock) : null;
  const goHome: UnitAction = home ? { type: 'sail', x: home.x + 0.5, y: home.y + 0.5 } : { type: 'idle' };
  if (u.troop === 'transport') {
    // 登陸作戰中：updateNaval 會指定航向
    if (f.landing?.shipId === u.id) return u.action;
    return goHome;
  }
  if (u.hp < u.maxHp * 0.35) return goHome;
  // 目前的目標還在就繼續打
  if (u.action.type === 'attackUnit') {
    const t = world.unitMap.get(u.action.targetId);
    if (t && isTargetable(t, u.x, u.y) && dist(u.x, u.y, t.x, t.y) <= SHIP_SIGHT + 2) return u.action;
  }
  let best: Unit | undefined;
  let bestD = SHIP_SIGHT;
  for (const e of world.units) {
    if (!isTargetable(e, u.x, u.y) || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d < bestD && shipCanReach(world, e)) {
      bestD = d;
      best = e;
    }
  }
  if (best) return { type: 'attackUnit', targetId: best.id };
  // 進攻時：轟擊敵方靠海的建築
  if (f.stance === 'attack' && f.targetFaction !== null && !world.factions[f.targetFaction].neutral) {
    let target: { id: number; d: number } | null = null;
    for (const b of factionBuildings(world, f.targetFaction)) {
      const c = centerOf(b);
      if (!nearestSeaTile(world, c.x, c.y, BALLISTA_RANGE - 0.5)) continue;
      const d = dist(u.x, u.y, c.x, c.y);
      if (!target || d < target.d) target = { id: b.id, d };
    }
    if (target) return { type: 'attackBuilding', targetId: target.id };
  }
  if (u.action.type === 'sail' && home && dist(u.action.x, u.action.y, home.x, home.y) < 6) return u.action;
  if (!home) return { type: 'idle' };
  // 在港口附近巡邏
  const p = nearestSeaTile(world, home.x + world.rng.range(-4, 4), home.y + world.rng.range(-4, 4), 3) ?? home;
  return { type: 'sail', x: p.x + 0.5, y: p.y + 0.5 };
}

/** 走到碼頭，等船靠岸就上船 */
export function boardTick(world: World, u: Unit, shipId: number): boolean {
  const ship = world.unitMap.get(shipId);
  const f = world.factions[u.factionId];
  if (!ship || ship.hp <= 0 || f.landing?.shipId !== shipId || f.landing.phase !== 'board') return false;
  if (dist(u.x, u.y, ship.x, ship.y) <= 2.6) {
    u.aboard = ship.id;
    u.path.length = 0;
    u.action = { type: 'idle' };
    return true;
  }
  const dock = docksOf(world, f.id)[0];
  const c = dock ? centerOf(dock) : { x: ship.x, y: ship.y };
  moveTo(world, u, c.x, c.y, 0.8);
  return true;
}

/** 船上的人跟著船走；船沉了就一起淹死 */
function syncPassengers(world: World): void {
  for (const u of world.units) {
    if (u.aboard === undefined || u.hp <= 0) continue;
    const ship = world.unitMap.get(u.aboard);
    if (!ship || ship.hp <= 0) {
      u.aboard = undefined;
      u.hp = 0;
      handleDeath(world, u, '隨船沉沒');
      logEvent(world, 'combat', `${unitLabel(u)} 隨運兵船沉入海底`, u.factionId);
      continue;
    }
    u.x = ship.x;
    u.y = ship.y;
  }
}

function passengersOf(world: World, shipId: number): Unit[] {
  return world.units.filter((u) => u.aboard === shipId && u.hp > 0);
}

/** 讓船上的人在 shore 附近上岸 */
function unload(world: World, shipId: number, shore: Point): number {
  const people = passengersOf(world, shipId);
  people.forEach((u, i) => {
    const angle = (i / Math.max(1, people.length)) * Math.PI * 2;
    u.aboard = undefined;
    u.x = shore.x + 0.5 + Math.cos(angle) * 0.35;
    u.y = shore.y + 0.5 + Math.sin(angle) * 0.35;
    u.action = { type: 'idle' };
    u.path.length = 0;
    u.thinkAt = world.tick;
  });
  return people.length;
}

/** 搶灘點離目標建築最遠多少格（再遠就不如走陸路） */
const LANDING_RANGE = 22;

/** 運兵船：挑一個敵方建築（營帳優先，其次靠海的），找離它最近、船開得到的搶灘點 */
function pickLanding(world: World, target: number, ship: Unit): { sea: Point; shore: Point; near: string } | null {
  const options: { sea: Point; shore: Point; near: string; d: number }[] = [];
  const buildings = factionBuildings(world, target)
    .map((b) => ({ b, rank: b.type === 'hq' ? 0 : b.type === 'dock' ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 6);
  for (const { b } of buildings) {
    const c = centerOf(b);
    const spot = landingSea(world, c.x, c.y, LANDING_RANGE);
    if (!spot) continue;
    const d = dist(c.x, c.y, spot.shore.x + 0.5, spot.shore.y + 0.5) + (b.type === 'hq' ? -3 : 0);
    options.push({ ...spot, near: b.type === 'hq' ? '營帳' : '領地', d });
  }
  options.sort((a, b) => a.d - b.d);
  // 分開的兩片海互不相通：只挑船開得到的地方
  for (const o of options.slice(0, 4)) {
    const reachable = findPath(world, Math.floor(ship.x), Math.floor(ship.y), o.sea.x, o.sea.y, world.width * world.height, false, true);
    if (reachable) return o;
  }
  return null;
}

function setSail(ship: Unit, p: Point): void {
  ship.action = { type: 'sail', x: p.x + 0.5, y: p.y + 0.5 };
  ship.path.length = 0;
  ship.pathGoal = null;
}

/** 進攻時，有空的運兵船就召集一隊戰士準備渡海 */
function startLanding(world: World, f: Faction): void {
  if (!f.tactics.landing || f.stance !== 'attack' || f.targetFaction === null || world.tick < f.nextLandingAt) return;
  const target = world.factions[f.targetFaction];
  if (!target.alive || target.neutral) return;
  const dock = docksOf(world, f.id)[0];
  const home = dock && dockWater(world, dock);
  if (!dock || !home) return;
  const ship = world.units.find((u) => u.factionId === f.id && u.troop === 'transport' && u.hp > u.maxHp * 0.5);
  if (!ship || dist(ship.x, ship.y, home.x + 0.5, home.y + 0.5) > 3) return;
  const spot = pickLanding(world, target.id, ship);
  if (!spot) {
    f.nextLandingAt = world.tick + LANDING_COOLDOWN;
    return;
  }
  const dc = centerOf(dock);
  const crew = world.units
    .filter(
      (u) =>
        u.factionId === f.id && u.hp > u.maxHp * 0.5 && u.role === 'warrior' && !isNaval(u) && u.troop !== 'scout' &&
        u.post === undefined && u.followHero === undefined && !u.hero?.possessed && u.aboard === undefined &&
        u.summonedBy === undefined && dist(u.x, u.y, dc.x, dc.y) <= BOARD_RADIUS,
    )
    .sort((a, b) => dist(a.x, a.y, dc.x, dc.y) - dist(b.x, b.y, dc.x, dc.y))
    .slice(0, TRANSPORT_CAPACITY);
  if (crew.length < 2) {
    f.nextLandingAt = world.tick + LANDING_COOLDOWN / 2;
    return;
  }
  f.landing = {
    shipId: ship.id, target: target.id, phase: 'board', passengers: crew.map((u) => u.id), since: world.tick,
    sea: spot.sea, shore: spot.shore,
  };
  setSail(ship, home);
  for (const u of crew) {
    u.action = { type: 'board', shipId: ship.id };
    u.path.length = 0;
    u.pathGoal = null;
  }
  logEvent(world, 'combat', `⛵ ${f.name} 在碼頭集結 ${crew.length} 名戰士，準備渡海突襲${target.name}的${spot.near}！`, f.id);
}

/** 登陸作戰的每個階段：上船 → 渡海 → 搶灘 → 回港 */
function runLanding(world: World, f: Faction): void {
  const plan = f.landing!;
  const ship = world.unitMap.get(plan.shipId);
  const dock = docksOf(world, f.id)[0];
  const home = dock ? dockWater(world, dock) : null;
  if (!ship || ship.hp <= 0) {
    f.landing = null;
    f.nextLandingAt = world.tick + LANDING_COOLDOWN;
    return;
  }
  const aboard = passengersOf(world, ship.id).length;
  const elapsed = world.tick - plan.since;
  const targetAlive = world.factions[plan.target].alive;

  if (plan.phase === 'board') {
    const waiting = plan.passengers.filter((id) => {
      const u = world.unitMap.get(id);
      return u && u.hp > 0 && u.aboard === undefined;
    }).length;
    const cancelled = !targetAlive || f.stance !== 'attack';
    if (cancelled || (elapsed > BOARD_SECONDS * TICKS_PER_SECOND * 1.5 && aboard < 2)) {
      if (home && dock) unload(world, ship.id, shoreBeside(world, home, centerOf(dock)) ?? home);
      f.landing = null;
      f.nextLandingAt = world.tick + LANDING_COOLDOWN;
      return;
    }
    if (aboard > 0 && (waiting === 0 || elapsed > BOARD_SECONDS * TICKS_PER_SECOND)) {
      plan.phase = 'sail';
      plan.since = world.tick;
      setSail(ship, plan.sea);
      logEvent(world, 'combat', `⛵ ${f.name} 的運兵船${ship.name}載著 ${aboard} 名戰士啟航！`, f.id);
    }
    return;
  }

  if (plan.phase === 'sail') {
    const arrived = dist(ship.x, ship.y, plan.sea.x + 0.5, plan.sea.y + 0.5) <= 1.2;
    // 航行太久（被擋住）就在原地找岸邊放人
    const stuck = elapsed > 120 * TICKS_PER_SECOND;
    if (arrived || stuck || !targetAlive) {
      const shore = arrived ? plan.shore : shoreBeside(world, { x: Math.floor(ship.x), y: Math.floor(ship.y) }, plan.shore);
      if (shore && targetAlive) {
        const n = unload(world, ship.id, shore);
        if (n) logEvent(world, 'combat', `⚓ ${f.name} 的 ${n} 名戰士在${world.factions[plan.target].name}的海岸搶灘登陸！`, f.id);
      }
      plan.phase = 'return';
      plan.since = world.tick;
      if (home) setSail(ship, home);
    }
    return;
  }

  // 回港
  const back = !home || dist(ship.x, ship.y, home.x + 0.5, home.y + 0.5) <= 1.5;
  if (back || elapsed > 120 * TICKS_PER_SECOND) {
    if (home && dock && aboard) unload(world, ship.id, shoreBeside(world, home, centerOf(dock)) ?? home);
    f.landing = null;
    f.nextLandingAt = world.tick + LANDING_COOLDOWN;
  }
}

/** 每個 tick：乘客跟著船；每秒：統籌登陸作戰、在港口修船 */
export function updateNaval(world: World): void {
  syncPassengers(world);
  if (world.tick % TICKS_PER_SECOND) return;
  for (const f of world.factions) {
    if (!f.alive || f.neutral) continue;
    if (f.landing) runLanding(world, f);
    else startLanding(world, f);
    const dock = docksOf(world, f.id)[0];
    const home = dock && dockWater(world, dock);
    if (!home) continue;
    for (const u of world.units) {
      if (u.factionId === f.id && isNaval(u) && u.hp > 0 && u.hp < u.maxHp && dist(u.x, u.y, home.x + 0.5, home.y + 0.5) <= 3) {
        u.hp = Math.min(u.maxHp, u.hp + DOCK_REPAIR);
      }
    }
  }
}

/** 船上的乘客人數（畫面與檢視面板用） */
export function cargoCount(world: World, ship: Unit): number {
  return passengersOf(world, ship.id).length;
}

/** 近戰的小兵打不到離岸太遠的船 */
export function canEngage(u: Unit, e: Unit, ranged: boolean): boolean {
  return !isNaval(e) || ranged || dist(u.x, u.y, e.x, e.y) <= 1.8;
}

