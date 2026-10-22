import { clamp, dist } from '../math';
import { RACES, RIVALRY } from '../races';
import type { Faction, Proposal, Unit, World } from '../types';
import { areHostile, centerOf, factionUnits, hqOf, isTargetable, logEvent, unitLabel } from '../util';
import { handleDeath } from './combat';
import { cancelCraft } from './crafting';
import { moveTo } from './movement';
import { adjustRelation, getTreaty, setTreaty } from './treaties';

const SUBVERT_COOLDOWN = 60;
/** 策反失敗時被識破處決的機率 */
const CAUGHT_CHANCE = 0.2;
const DIPLOMACY_INTERVAL = 20;

const PROPOSAL_NAMES: Record<Proposal, string> = { peace: '停戰', alliance: '結盟' };

const warriorsOf = (world: World, f: Faction) => factionUnits(world, f.id).filter((u) => u.role === 'warrior').length;

/** 有沒有雙方都在交戰的第三方（共同敵人） */
export function hasCommonEnemy(world: World, a: number, b: number): boolean {
  return world.factions.some(
    (z) => z.alive && z.id !== a && z.id !== b && areHostile(world, a, z.id) && areHostile(world, b, z.id),
  );
}

// ───────────── 忠誠度 ─────────────

/**
 * 忠誠度會慢慢靠近這個目標值：
 * 魅力高的人天生忠誠；挨餓、生病、士氣低落、陣營節節敗退都會讓人動搖。
 */
export function loyaltyTarget(world: World, u: Unit): number {
  const f = world.factions[u.factionId];
  const momentum = clamp((f.stats.kills - f.stats.deaths) / 5, -15, 15);
  return clamp(
    50 + u.attrs.cha * 2 - u.hunger * 40 - (u.sick ? 10 : 0) - (u.morale < 30 ? 15 : 0) + momentum,
    0,
    100,
  );
}

export function updateLoyalty(world: World): void {
  for (const u of world.units) {
    if (u.hp <= 0) continue;
    u.loyalty += (loyaltyTarget(world, u) - u.loyalty) * 0.002;
  }
}

// ───────────── 策反 ─────────────

/** 說服成功率：外交官的魅力（其次智慧）對上目標的忠誠度 */
export function persuadeChance(world: World, envoy: Unit, target: Unit): number {
  const p = 0.25 + (envoy.attrs.cha - 10) * 0.03 + (envoy.attrs.int - 10) * 0.01 - (target.loyalty - 50) * 0.012;
  return clamp(p * world.rules.subvertMult, 0, 0.6);
}

export function defect(world: World, t: Unit, by: Unit): void {
  const oldF = world.factions[t.factionId];
  const newF = world.factions[by.factionId];
  if (t.action.type === 'craft') cancelCraft(world, t);
  t.factionId = newF.id;
  t.action = { type: 'idle' };
  t.path.length = 0;
  t.pathGoal = null;
  t.carrying = null;
  t.loyalty = 70;
  t.morale = 60;
  t.thinkAt = world.tick;
  oldF.stats.defected++;
  newF.stats.recruited++;
  adjustRelation(world, oldF.id, newF.id, -8);
  logEvent(world, 'diplomacy', `${unitLabel(t)} 被 ${unitLabel(by)} 說服，倒戈投奔 ${newF.name}！`, newF.id);
}

/** 外交官挑一個最容易說服、又不太危險的敵人 */
export function pickSubvertTarget(world: World, u: Unit): Unit | null {
  if (world.rules.subvertMult <= 0) return null;
  let best: Unit | null = null;
  let bestScore = 0;
  for (const t of world.units) {
    if (!isTargetable(t, u.x, u.y) || t.loyalty >= 75 || !areHostile(world, u.factionId, t.factionId)) continue;
    const d = dist(u.x, u.y, t.x, t.y);
    if (d > 30) continue;
    const theirHq = hqOf(world, world.factions[t.factionId]);
    const nearTheirHq = theirHq && dist(t.x, t.y, centerOf(theirHq).x, centerOf(theirHq).y) < 7;
    const score = (75 - t.loyalty) * 1.5 - d * 0.8 - (nearTheirHq ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function subvertTick(world: World, u: Unit, targetId: number): boolean {
  const t = world.unitMap.get(targetId);
  if (!t || !isTargetable(t, u.x, u.y) || !areHostile(world, u.factionId, t.factionId)) return false;
  if (!moveTo(world, u, t.x, t.y, 1.4)) return true;
  if (u.cooldown > 0) return true;
  u.cooldown = SUBVERT_COOLDOWN;

  if (world.rng.chance(persuadeChance(world, u, t))) {
    defect(world, t, u);
    return false;
  }
  t.loyalty = Math.min(100, t.loyalty + 3);
  if (world.rng.chance(CAUGHT_CHANCE)) {
    u.hp = 0;
    handleDeath(world, u);
    adjustRelation(world, t.factionId, u.factionId, -5);
    logEvent(world, 'diplomacy', `${unitLabel(u)} 策反 ${unitLabel(t)} 失敗，身分敗露遭到處決`, t.factionId);
  }
  return false;
}

// ───────────── 出使 ─────────────

/** 對方接受提議的機率 */
export function proposalChance(world: World, from: Faction, to: Faction, proposal: Proposal, envoy: Unit): number {
  let p = 0.25 + (envoy.attrs.cha - 10) * 0.04 + (envoy.attrs.int - 10) * 0.01 + to.relations[from.id] / 200;
  const common = hasCommonEnemy(world, from.id, to.id);
  if (proposal === 'peace') {
    if (warriorsOf(world, from) > warriorsOf(world, to) * 1.2) p += 0.15; // 對方畏懼我們
    if (common) p += 0.1;
  } else {
    p += common ? 0.2 : -0.2;
    if (getTreaty(world, from.id, to.id) !== 'peace') p -= 0.3;
  }
  return clamp(p, 0.03, 0.9);
}

export function envoyTick(world: World, u: Unit): boolean {
  if (u.action.type !== 'envoy') return false;
  const a = u.action;
  const from = world.factions[u.factionId];
  const to = world.factions[a.target];

  if (a.returning || !to.alive) {
    const home = hqOf(world, from);
    if (!home) return false;
    const c = centerOf(home);
    return !moveTo(world, u, c.x, c.y, 2);
  }
  const theirHq = hqOf(world, to);
  if (!theirHq) return false;
  const c = centerOf(theirHq);
  if (!moveTo(world, u, c.x, c.y, 2.5)) return true;

  const already = a.proposal === 'peace' ? getTreaty(world, from.id, to.id) !== 'war' : getTreaty(world, from.id, to.id) === 'alliance';
  if (!already) {
    const name = PROPOSAL_NAMES[a.proposal];
    if (world.rng.chance(proposalChance(world, from, to, a.proposal, u))) {
      setTreaty(world, from.id, to.id, a.proposal === 'peace' ? 'peace' : 'alliance');
      adjustRelation(world, from.id, to.id, 15);
      adjustRelation(world, to.id, from.id, 15);
      from.stats.treaties++;
      for (const f of [from, to]) {
        if (f.stance === 'attack' && (f.targetFaction === from.id || f.targetFaction === to.id)) {
          f.stance = 'defend';
          f.targetFaction = null;
        }
      }
      logEvent(world, 'diplomacy', `${unitLabel(u)} 說服 ${to.name} 與 ${from.name} ${name}！`, from.id);
    } else {
      adjustRelation(world, from.id, to.id, -3);
      logEvent(world, 'diplomacy', `${to.name} 拒絕了 ${from.name} 的${name}提議`, to.id);
    }
  }
  a.returning = true;
  u.path.length = 0;
  return true;
}

/** 派一名有空的外交官出使；沒有外交官時回傳 false */
export function sendEnvoy(world: World, f: Faction, target: number, proposal: Proposal): boolean {
  const envoy = world.units.find(
    (u) => u.factionId === f.id && u.hp > 0 && u.role === 'diplomat' && u.action.type !== 'envoy',
  );
  if (!envoy) return false;
  envoy.action = { type: 'envoy', target, proposal, returning: false };
  envoy.path.length = 0;
  envoy.pathGoal = null;
  return true;
}

export function declareWar(world: World, f: Faction, target: number): void {
  const prev = getTreaty(world, f.id, target);
  if (prev === 'war') return;
  setTreaty(world, f.id, target, 'war');
  adjustRelation(world, target, f.id, -25);
  const what = prev === 'alliance' ? '同盟' : '和約';
  logEvent(world, 'diplomacy', `${f.name} 撕毀與 ${world.factions[target].name} 的${what}，宣戰！`, f.id);
}

// ───────────── 每隔一段時間的外交更新 ─────────────

/** 關係值回歸種族宿怨、條約帶來好感、神諭停戰到期、最後兩強必有一戰 */
export function updateDiplomacy(world: World): void {
  if (world.tick % DIPLOMACY_INTERVAL !== 0) return;
  const alive = world.factions.filter((f) => f.alive);

  for (const a of alive) {
    for (const b of alive) {
      if (a.id === b.id) continue;
      const base = RIVALRY[a.race][b.race];
      let rel = a.relations[b.id];
      rel += (base - rel) * 0.01;
      const t = getTreaty(world, a.id, b.id);
      if (t === 'peace') rel += 0.3;
      if (t === 'alliance') rel += 0.5;
      if (hasCommonEnemy(world, a.id, b.id)) rel += 0.2;
      a.relations[b.id] = clamp(rel, -100, 100);

      const until = world.truceUntil[a.id]?.[b.id] ?? 0;
      if (until > 0 && world.tick >= until && a.id < b.id) {
        setTreaty(world, a.id, b.id, 'war');
        logEvent(world, 'diplomacy', `神諭停戰期滿，${a.name} 與 ${b.name} 重新開戰`, -1);
      }
    }
  }

  if (alive.length === 2) {
    const [a, b] = alive;
    const t = getTreaty(world, a.id, b.id);
    if (t === 'peace' || (t === 'alliance' && !world.rules.allianceVictory)) {
      setTreaty(world, a.id, b.id, 'war');
      logEvent(world, 'diplomacy', `天下只剩兩強，${a.name} 與 ${b.name} 的盟約瓦解，決戰開始！`, -1);
    }
  }
}

/** 所有存活陣營彼此都是同盟 */
export function isAllianceVictory(world: World): boolean {
  if (!world.rules.allianceVictory) return false;
  const alive = world.factions.filter((f) => f.alive);
  if (alive.length < 2) return false;
  return alive.every((a) => alive.every((b) => getTreaty(world, a.id, b.id) === 'alliance'));
}

/** 魅力高的種族（人類）會多培養外交官 */
export const raceIsDiplomatic = (f: Faction): boolean => RACES[f.race].base.cha >= 12;
