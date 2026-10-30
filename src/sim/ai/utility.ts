import { HQ_THREAT_RADIUS, MAX_BUILDERS, MILITIA_RADIUS, SIGHT } from '../constants';
import { resolveDef } from '../items';
import { dist } from '../math';
import { carryOf } from '../stats';
import type { Faction, ResourceKind, Unit, UnitAction, World } from '../types';
import {
  areHostile, canAfford, centerOf, enemiesNear, factionBuildings, hasCompleted, hqOf, isTargetable, nearestEnemyUnit,
} from '../util';
import { cancelCraft, isItemUnlocked, startCraft } from '../systems/crafting';
import { findNearestResource, isResourceTile } from '../systems/economy';
import { bestArmoryUpgrade } from '../systems/equipment';
import { pickSubvertTarget } from '../systems/diplomacy';
import { findAmbushSpot } from '../systems/troopActions';
import { followerThink } from '../systems/heroSystem';
import { pickScoutTarget } from '../fog';
import { RETREAT_MULT, musterTarget, pickFocusTarget } from '../tactics';

/**
 * 個體 Utility AI：列出所有可做的事、各自打分，挑最高分的去做。
 * 分數只是相對大小；調整數字就能改變小人的「個性」。
 */

interface Option {
  score: number;
  action: UnitAction | (() => boolean);
}

const RESOURCE_KINDS: ResourceKind[] = ['food', 'wood', 'stone', 'ore'];

export function think(world: World, u: Unit): void {
  // 「跟隨我」小隊：血量太低才會脫隊撤退
  if (u.followHero !== undefined && u.hp > u.maxHp * 0.25 && followerThink(world, u)) return;
  if (u.troop === 'scout') {
    scoutThink(world, u);
    return;
  }
  const f = world.factions[u.factionId];
  const hq = hqOf(world, f);
  if (!hq) return;
  const options: Option[] = [{ score: 0, action: { type: 'idle' } }];
  const add = (score: number, action: Option['action']) => options.push({ score, action });

  const hpRatio = u.hp / u.maxHp;
  // 戰士依集火設定挑目標，其他人只看最近的威脅
  const focus = u.role === 'warrior' ? f.tactics.focus : 'nearest';
  const enemy = focus === 'nearest' ? nearestEnemyUnit(world, u, SIGHT) : pickFocusTarget(world, u, focus);
  const enemyDist = enemy ? dist(u.x, u.y, enemy.x, enemy.y) : Infinity;
  const resting = u.action.type === 'retreat';

  // 地底的工兵不受地面戰況影響，一路挖到底
  if (u.underground && (u.action.type === 'tunnel' || u.action.type === 'garrison')) add(98, u.action);

  if (u.role === 'warrior') {
    let s = (1 - hpRatio) * 90 + (u.morale < 25 ? 70 : 0);
    // 進攻中的部隊比較拚命，只有士氣崩潰才會撤退
    if (f.stance === 'attack') s *= 0.6;
    else if (u.sick) s += 30;
    if (resting && u.sick && f.stance !== 'attack') s = Math.max(s, 80);
    s *= RETREAT_MULT[f.tactics.retreat];
    const healedAt = f.tactics.retreat === 'cautious' ? 0.95 : 0.85;
    if (resting && (hpRatio < healedAt || u.morale < 55)) s = Math.max(s, 92);
    // 鳴金收兵：全軍撤回
    if (world.tick < f.recallUntil) s = Math.max(s, 96);
    add(s, { type: 'retreat' });
    warriorOptions(world, u, f, add, enemy, enemyDist);
  } else {
    // 出使中的外交官不會被打斷
    if (u.action.type === 'envoy') add(99, u.action);
    // 外交官要接近敵人才能策反，只要還健康就不會見到敵人就跑
    const daring = u.role === 'diplomat' && hpRatio > 0.5;
    // 民兵：敵人打到家門口時，健康的工人與鐵匠也會上前迎戰
    const hc = centerOf(hq);
    if (enemy && hpRatio > 0.5 && dist(enemy.x, enemy.y, hc.x, hc.y) <= MILITIA_RADIUS) {
      add(91, { type: 'attackUnit', targetId: enemy.id });
    }
    if (enemy && enemyDist < 5 && !daring) add(88, { type: 'retreat' });
    if (resting && enemy && enemyDist < 8) add(85, { type: 'retreat' });
    if (hpRatio < 0.5) add(70 + (1 - hpRatio) * 30, { type: 'retreat' });
    if (resting && hpRatio < 0.9) add(80, { type: 'retreat' });
    if (u.sick) add(78, { type: 'retreat' });
    if (u.role === 'diplomat') diplomatOptions(world, u, add);
    civilianOptions(world, u, f, add);
  }

  let best = options[0];
  for (const o of options) if (o.score > best.score) best = o;
  if (typeof best.action === 'function') {
    if (u.action.type === 'craft') cancelCraft(world, u);
    if (!best.action()) setAction(world, u, { type: 'idle' });
  } else {
    setAction(world, u, best.action);
  }
}

function sameAction(a: UnitAction, b: UnitAction): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'gather': return b.type === 'gather' && a.tx === b.tx && a.ty === b.ty && a.kind === b.kind;
    case 'build': return b.type === 'build' && a.buildingId === b.buildingId;
    case 'attackUnit': return b.type === 'attackUnit' && a.targetId === b.targetId;
    case 'attackBuilding': return b.type === 'attackBuilding' && a.targetId === b.targetId;
    case 'subvert': return b.type === 'subvert' && a.targetId === b.targetId;
    case 'tunnel': return b.type === 'tunnel' && a.targetId === b.targetId;
    case 'ambush': return b.type === 'ambush' && a.x === b.x && a.y === b.y;
    case 'garrison': return b.type === 'garrison' && a.outpostId === b.outpostId;
    case 'scout': return b.type === 'scout' && a.x === b.x && a.y === b.y;
    case 'guard': return b.type === 'guard' && Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3;
    case 'craft': return true;
    default: return true;
  }
}

function setAction(world: World, u: Unit, action: UnitAction): void {
  if (sameAction(u.action, action)) return;
  if (u.action.type === 'craft') cancelCraft(world, u);
  if (u.underground && action.type !== 'tunnel' && world.tick >= u.surfaceAt) u.underground = false;
  u.action = action;
  u.path.length = 0;
  u.pathGoal = null;
}

function warriorOptions(
  world: World, u: Unit, f: Faction, add: (s: number, a: Option['action']) => void,
  enemy: Unit | undefined, enemyDist: number,
): void {
  const hq = hqOf(world, f)!;
  const hc = centerOf(hq);

  // 保衛營帳最優先
  const threats = enemiesNear(world, f.id, hc.x, hc.y, HQ_THREAT_RADIUS);
  if (threats.length) {
    let nearest = threats[0];
    for (const t of threats) if (dist(u.x, u.y, t.x, t.y) < dist(u.x, u.y, nearest.x, nearest.y)) nearest = t;
    add(85, { type: 'attackUnit', targetId: nearest.id });
  }

  if (u.action.type === 'attackUnit') {
    const cur = world.unitMap.get(u.action.targetId);
    if (cur && cur.hp > 0) add(76, u.action);
  }
  // 駐守的士兵不去招惹巢穴邊的怪物（除非怪物貼上來，或正在討伐巢穴）
  const huntingLairs = f.stance === 'attack' && f.targetFaction !== null && world.factions[f.targetFaction].neutral;
  const ignoreMonster = u.post !== undefined && !!enemy?.monster && !huntingLairs && enemyDist > 2.5;
  if (enemy && !ignoreMonster) add(72 - enemyDist * 2, { type: 'attackUnit', targetId: enemy.id });
  // 宿敵就在眼前：血債血償
  for (const n of f.nemeses) {
    const foe = world.unitMap.get(n.unitId);
    if (foe && isTargetable(foe, u.x, u.y) && dist(u.x, u.y, foe.x, foe.y) <= SIGHT) {
      add(80 + Math.min(10, n.grudge / 20), { type: 'attackUnit', targetId: foe.id });
      break;
    }
  }

  // 駐守據點：比跟著大軍攻城優先，但看到敵人還是會迎戰
  if (u.post !== undefined) add(50, { type: 'garrison', outpostId: u.post });

  const up = bestArmoryUpgrade(f, u);
  if (up && !enemy) add(55 + Math.min(up.gain * 3, 20), { type: 'equip' });

  // 集結進攻：先到前線的集結點等大家
  const rally = u.post === undefined ? musterTarget(world, f) : null;
  if (rally) add(60, { type: 'guard', x: rally.x + world.rng.range(-1.5, 1.5), y: rally.y + world.rng.range(-1.5, 1.5) });

  if (f.stance === 'attack' && f.targetFaction !== null && world.factions[f.targetFaction].alive) {
    const targets = factionBuildings(world, f.targetFaction);
    let tb = targets[0];
    for (const b of targets) {
      const c = centerOf(b);
      const tc = centerOf(tb);
      if (dist(u.x, u.y, c.x, c.y) < dist(u.x, u.y, tc.x, tc.y)) tb = b;
    }
    if (tb) {
      add(45, { type: 'attackBuilding', targetId: tb.id });
      // 地道工兵：挖地道直搗建築，避開正面的箭塔與守軍
      if (u.troop === 'sapper') add(50, { type: 'tunnel', targetId: tb.id });
    }
  }

  // 林地伏兵：防守時躲進森林，守在敵人來的方向
  if (u.troop === 'ranger' && f.stance !== 'attack') {
    if (u.action.type === 'ambush') add(14, u.action);
    else {
      const spot = findAmbushSpot(world, u);
      if (spot) add(14, { type: 'ambush', x: spot.x, y: spot.y });
    }
  }

  if (u.action.type === 'guard') {
    add(10, u.action);
  } else {
    // 在營帳朝地圖中心的方向站崗
    const toCx = Math.sign(world.width / 2 - hc.x);
    const toCy = Math.sign(world.height / 2 - hc.y);
    add(10, {
      type: 'guard',
      x: hc.x + toCx * 4 + world.rng.range(-2, 2),
      y: hc.y + toCy * 4 + world.rng.range(-2, 2),
    });
  }
}

/**
 * 斥候：不打仗、不佔領，只負責看。受傷就回家，看到敵人就往反方向跑，
 * 其餘時間跑去最久沒看過的地方（或玩家指定的地點）。
 */
function scoutThink(world: World, u: Unit): void {
  const hpRatio = u.hp / u.maxHp;
  if (hpRatio < 0.35 || (u.action.type === 'retreat' && hpRatio < 0.85)) {
    setAction(world, u, { type: 'retreat' });
    return;
  }
  const enemy = nearestEnemyUnit(world, u, 6);
  if (enemy) {
    const d = Math.max(0.1, dist(u.x, u.y, enemy.x, enemy.y));
    const x = Math.min(world.width - 1, Math.max(1, u.x + ((u.x - enemy.x) / d) * 6));
    const y = Math.min(world.height - 1, Math.max(1, u.y + ((u.y - enemy.y) / d) * 6));
    setAction(world, u, { type: 'scout', x, y });
    return;
  }
  const target = world.fog?.factionId === u.factionId ? world.fog.scoutTarget : null;
  const cur = u.action;
  // 還在路上就繼續走（找不到路的地點就換一個）
  const onTheWay = cur.type === 'scout' && (u.path.length > 0 || dist(u.x, u.y, cur.x, cur.y) < 2);
  if (onTheWay && (!target || (cur.x === target.x && cur.y === target.y))) return;
  const p = pickScoutTarget(world, u);
  setAction(world, u, { type: 'scout', x: p.x, y: p.y });
}

/** 外交官沒有出使任務時，會去策反忠誠度低的敵人 */
function diplomatOptions(world: World, u: Unit, add: (s: number, a: Option['action']) => void): void {
  if (u.action.type === 'subvert') {
    const t = world.unitMap.get(u.action.targetId);
    if (t && t.hp > 0 && areHostile(world, u.factionId, t.factionId)) {
      add(62, u.action);
      return;
    }
  }
  const target = pickSubvertTarget(world, u);
  if (target) add(58, { type: 'subvert', targetId: target.id });
}

function civilianOptions(world: World, u: Unit, f: Faction, add: (s: number, a: Option['action']) => void): void {
  if (u.carrying && u.carrying.amount >= carryOf(u.attrs) - 0.01) add(80, { type: 'deliver' });

  if (u.role === 'smith') {
    if (u.action.type === 'craft') add(90, u.action);
    else if (hasAffordableCraft(world, f)) add(75, () => startCraft(world, u));
  }

  // 工地：最多 MAX_BUILDERS 人一起蓋
  const sites = factionBuildings(world, f.id).filter((b) => !b.complete);
  for (const site of sites) {
    const builders = world.units.filter(
      (o) => o !== u && o.hp > 0 && o.action.type === 'build' && o.action.buildingId === site.id,
    ).length;
    const already = u.action.type === 'build' && u.action.buildingId === site.id;
    if (builders < MAX_BUILDERS || already) {
      add(u.role === 'worker' ? 62 : 30, { type: 'build', buildingId: site.id });
      break;
    }
  }

  const want = pickGatherKind(world, f, u);
  if (u.carrying && u.carrying.amount > 0 && u.carrying.kind !== want) add(55, { type: 'deliver' });
  // 正在送貨就先送完，不必重新找資源
  if (u.action.type === 'deliver' && u.carrying) {
    add(50, u.action);
    return;
  }

  const cur = u.action;
  if (cur.type === 'gather' && cur.kind === want) {
    const t = world.tiles[cur.ty * world.width + cur.tx];
    if (isResourceTile(cur.kind, t) && t.amount > 0.01) {
      add(45, cur);
      return;
    }
  }
  for (const kind of [want, ...RESOURCE_KINDS.filter((k) => k !== want)]) {
    const spot = findNearestResource(world, u, kind);
    if (spot) {
      add(kind === want ? 40 : 20, { type: 'gather', kind, tx: spot.x, ty: spot.y });
      return;
    }
  }
}

function hasAffordableCraft(world: World, f: Faction): boolean {
  const hasForge = hasCompleted(world, f.id, 'forge');
  return f.craftQueue.some((id) => {
    const def = resolveDef(f, id);
    return !!def && isItemUnlocked(def, f, hasForge) && canAfford(f.resources, def.cost);
  });
}

/**
 * 依陣營 AI 設定的權重分配採集工作。
 * 用單位 id 做固定的「輪盤位置」，所以權重不變時每個工人會穩定負責同一種資源。
 */
/**
 * 依陣營的採集權重分配工作：用工人在自家的排行（黃金比例分散）決定他採什麼，
 * 各陣營的分配比例一樣，不會因為編號先後而偏向某一邊。
 */
export function pickGatherKind(world: World, f: Faction, u: Unit): ResourceKind {
  const total = RESOURCE_KINDS.reduce((s, k) => s + f.gatherWeights[k], 0);
  if (total <= 0) return 'food';
  let rank = 0;
  for (const o of world.units) if (o.factionId === f.id && o.role === u.role && o.hp > 0 && o.id < u.id) rank++;
  let r = ((rank * 0.6180339887 + 0.3) % 1) * total;
  for (const k of RESOURCE_KINDS) {
    r -= f.gatherWeights[k];
    if (r < 0) return k;
  }
  return 'food';
}
