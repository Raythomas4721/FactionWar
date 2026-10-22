import { HQ_THREAT_RADIUS, MAX_BUILDERS, MILITIA_RADIUS, SIGHT } from '../constants';
import { ITEM_DEFS } from '../items';
import { dist } from '../math';
import { carryOf } from '../stats';
import type { Faction, ResourceKind, Unit, UnitAction, World } from '../types';
import {
  canAfford, centerOf, enemiesNear, factionBuildings, hasCompleted, hqOf, nearestEnemyUnit,
} from '../util';
import { cancelCraft, isItemUnlocked, startCraft } from '../systems/crafting';
import { RESOURCE_TILE, findNearestResource } from '../systems/economy';
import { bestArmoryUpgrade } from '../systems/equipment';

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
  const f = world.factions[u.factionId];
  const hq = hqOf(world, f);
  if (!hq) return;
  const options: Option[] = [{ score: 0, action: { type: 'idle' } }];
  const add = (score: number, action: Option['action']) => options.push({ score, action });

  const hpRatio = u.hp / u.maxHp;
  const enemy = nearestEnemyUnit(world, u, SIGHT);
  const enemyDist = enemy ? dist(u.x, u.y, enemy.x, enemy.y) : Infinity;
  const resting = u.action.type === 'retreat';

  if (u.role === 'warrior') {
    let s = (1 - hpRatio) * 90 + (u.morale < 25 ? 70 : 0);
    // 進攻中的部隊比較拚命，只有士氣崩潰才會撤退
    if (f.stance === 'attack') s *= 0.6;
    if (resting && (hpRatio < 0.85 || u.morale < 55)) s = Math.max(s, 92);
    add(s, { type: 'retreat' });
    warriorOptions(world, u, f, add, enemy, enemyDist);
  } else {
    // 民兵：敵人打到家門口時，健康的工人與鐵匠也會上前迎戰
    const hc = centerOf(hq);
    if (enemy && hpRatio > 0.5 && dist(enemy.x, enemy.y, hc.x, hc.y) <= MILITIA_RADIUS) {
      add(91, { type: 'attackUnit', targetId: enemy.id });
    }
    if (enemy && enemyDist < 5) add(88, { type: 'retreat' });
    if (resting && enemy && enemyDist < 8) add(85, { type: 'retreat' });
    if (hpRatio < 0.5) add(70 + (1 - hpRatio) * 30, { type: 'retreat' });
    if (resting && hpRatio < 0.9) add(80, { type: 'retreat' });
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
    case 'guard': return true;
    case 'craft': return true;
    default: return true;
  }
}

function setAction(world: World, u: Unit, action: UnitAction): void {
  if (sameAction(u.action, action)) return;
  if (u.action.type === 'craft') cancelCraft(world, u);
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
  if (enemy) add(72 - enemyDist * 2, { type: 'attackUnit', targetId: enemy.id });

  const up = bestArmoryUpgrade(f, u);
  if (up && !enemy) add(55 + Math.min(up.gain * 3, 20), { type: 'equip' });

  if (f.stance === 'attack' && f.targetFaction !== null && world.factions[f.targetFaction].alive) {
    const targets = factionBuildings(world, f.targetFaction);
    let tb = targets[0];
    for (const b of targets) {
      const c = centerOf(b);
      const tc = centerOf(tb);
      if (dist(u.x, u.y, c.x, c.y) < dist(u.x, u.y, tc.x, tc.y)) tb = b;
    }
    if (tb) add(45, { type: 'attackBuilding', targetId: tb.id });
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

  const want = pickGatherKind(f, u);
  if (u.carrying && u.carrying.amount > 0 && u.carrying.kind !== want) add(55, { type: 'deliver' });

  const cur = u.action;
  if (cur.type === 'gather' && cur.kind === want) {
    const t = world.tiles[cur.ty * world.width + cur.tx];
    if (t.kind === RESOURCE_TILE[cur.kind] && t.amount > 0) {
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
    const def = ITEM_DEFS[id];
    return isItemUnlocked(def, f, hasForge) && canAfford(f.resources, def.cost);
  });
}

/**
 * 依陣營 AI 設定的權重分配採集工作。
 * 用單位 id 做固定的「輪盤位置」，所以權重不變時每個工人會穩定負責同一種資源。
 */
export function pickGatherKind(f: Faction, u: Unit): ResourceKind {
  const total = RESOURCE_KINDS.reduce((s, k) => s + f.gatherWeights[k], 0);
  if (total <= 0) return 'food';
  let r = ((Math.imul(u.id, 2654435761) >>> 0) % 1000) / 1000 * total;
  for (const k of RESOURCE_KINDS) {
    r -= f.gatherWeights[k];
    if (r < 0) return k;
  }
  return 'food';
}
