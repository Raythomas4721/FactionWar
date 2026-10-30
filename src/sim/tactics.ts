import { HQ_THREAT_RADIUS, SIGHT, TICKS_PER_SECOND } from './constants';
import { itemDef } from './items';
import { dist } from './math';
import type { Faction, FocusTactic, Point, RetreatTactic, TacticAbility, Tactics, Unit, World } from './types';
import {
  areHostile, centerOf, enemiesNear, factionBuildings, factionUnits, hqOf, isPassable, isTargetable, logEvent,
} from './util';

/**
 * 戰術：玩家（與 AI）對全軍下的常駐設定，以及有冷卻時間的戰術指令。
 * 設定改變小兵「怎麼打」，指令是關鍵時刻的一次性爆發。
 */

export const DEFAULT_TACTICS: Tactics = { retreat: 'normal', focus: 'nearest', muster: false };

export const RETREAT_LABEL: Record<RetreatTactic, { icon: string; name: string; desc: string }> = {
  cautious: { icon: '🩹', name: '保守', desc: '受傷就回營帳養傷，死得少、推進慢' },
  normal: { icon: '⚖', name: '標準', desc: '傷得重或士氣低才撤退' },
  fierce: { icon: '💀', name: '死戰', desc: '幾乎不撤退，一路打到底，傷亡也大' },
};

export const FOCUS_LABEL: Record<FocusTactic, { icon: string; name: string; desc: string }> = {
  nearest: { icon: '🎯', name: '就近', desc: '打最近的敵人' },
  weakest: { icon: '🩸', name: '補刀', desc: '先收拾血少的敵人，盡快減少敵方人數' },
  ranged: { icon: '🏹', name: '打弓手', desc: '衝過前排，先解決弓箭手與法師' },
  heroes: { icon: '👑', name: '斬將', desc: '集火敵方英雄' },
};

/** 撤退分數倍率（乘在「想撤退」的分數上） */
export const RETREAT_MULT: Record<RetreatTactic, number> = { cautious: 1.5, normal: 1, fierce: 0.35 };

export interface AbilityDef {
  id: TacticAbility;
  name: string;
  /** 手機版按鈕上的短名 */
  short: string;
  icon: string;
  desc: string;
  /** 持續秒數（0 = 立即生效） */
  seconds: number;
  cooldown: number;
}

export const ABILITIES: Record<TacticAbility, AbilityDef> = {
  charge: {
    id: 'charge', name: '衝鋒號', short: '衝鋒', icon: '🎺', seconds: 15, cooldown: 90,
    desc: '全軍士氣大振：15 秒內移動 +30%、傷害 +10%',
  },
  shieldwall: {
    id: 'shieldwall', name: '盾牆', short: '盾牆', icon: '🛡', seconds: 20, cooldown: 90,
    desc: '全軍舉盾：20 秒內受到的傷害 −30%，但移動 −25%',
  },
  recall: {
    id: 'recall', name: '鳴金收兵', short: '收兵', icon: '🔔', seconds: 0, cooldown: 60,
    desc: '全軍立刻撤回營帳（改為防守），士氣回復一些',
  },
};

export const ABILITY_ORDER: TacticAbility[] = ['charge', 'shieldwall', 'recall'];

/** 集結最多等多久就出發（秒） */
const MUSTER_MAX_SECONDS = 40;
/** 到了集結點附近幾格算到齊 */
const MUSTER_RADIUS = 4;
/** 幾成的兵到齊就出發 */
const MUSTER_SHARE = 0.75;

export function abilityCooldown(world: World, f: Faction, id: TacticAbility): number {
  return Math.max(0, (f.abilityReadyAt[id] ?? 0) - world.tick);
}

function fieldWarriors(world: World, f: Faction): Unit[] {
  return factionUnits(world, f.id).filter(
    (u) => u.role === 'warrior' && !u.monster && u.troop !== 'scout' && u.post === undefined && u.followHero === undefined,
  );
}

/** 發動戰術指令；冷卻中回傳 false */
export function useAbility(world: World, f: Faction, id: TacticAbility): boolean {
  if (!f.alive || abilityCooldown(world, f, id) > 0) return false;
  const def = ABILITIES[id];
  f.abilityReadyAt[id] = world.tick + def.cooldown * TICKS_PER_SECOND;
  const until = world.tick + def.seconds * TICKS_PER_SECOND;
  const warriors = fieldWarriors(world, f);
  if (id === 'charge') {
    f.modifiers.push({ source: 'tactic', name: def.name, icon: def.icon, mods: { speed: 1.3, damage: 1.1 }, until });
    for (const u of warriors) u.morale = Math.min(100, u.morale + 40);
  } else if (id === 'shieldwall') {
    f.modifiers.push({ source: 'tactic', name: def.name, icon: def.icon, mods: { defense: 0.7, speed: 0.75 }, until });
  } else {
    f.stance = 'defend';
    f.targetFaction = null;
    f.musterAt = null;
    f.recallUntil = world.tick + 12 * TICKS_PER_SECOND;
    for (const u of warriors) {
      u.morale = Math.min(100, u.morale + 25);
      u.thinkAt = world.tick;
    }
  }
  logEvent(world, 'combat', `${f.name} 發動戰術「${def.icon} ${def.name}」`, f.id);
  return true;
}

/** 依集火設定挑目標：距離扣掉偏好的加成，越小越優先 */
export function pickFocusTarget(world: World, u: Unit, focus: FocusTactic, radius = SIGHT): Unit | undefined {
  let best: Unit | undefined;
  let bestCost = Infinity;
  for (const e of world.units) {
    if (!isTargetable(e, u.x, u.y) || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d > radius) continue;
    let bonus = 0;
    if (focus === 'weakest') bonus = 5 * (1 - e.hp / e.maxHp);
    else if (focus === 'ranged') bonus = e.weapon && itemDef(e.weapon).ranged ? 5 : 0;
    else if (focus === 'heroes') bonus = e.hero ? 6 : 0;
    // 怪物不算在集火偏好裡，只看距離
    if (e.monster) bonus = 0;
    const cost = d - bonus;
    if (cost < bestCost) {
      bestCost = cost;
      best = e;
    }
  }
  return best;
}

/** 集結點：從營帳往目標走四成的路，找附近能站的地方 */
export function musterPoint(world: World, f: Faction): Point | null {
  const hq = hqOf(world, f);
  if (!hq || f.targetFaction === null) return null;
  const targets = factionBuildings(world, f.targetFaction);
  if (!targets.length) return null;
  const from = centerOf(hq);
  let to = centerOf(targets[0]);
  for (const b of targets) {
    const c = centerOf(b);
    if (dist(from.x, from.y, c.x, c.y) < dist(from.x, from.y, to.x, to.y)) to = c;
  }
  const x = from.x + (to.x - from.x) * 0.4;
  const y = from.y + (to.y - from.y) * 0.4;
  for (let r = 0; r <= 4; r++) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      if (isPassable(world, Math.floor(x + dx), Math.floor(y + dy))) return { x: Math.floor(x + dx) + 0.5, y: Math.floor(y + dy) + 0.5 };
    }
  }
  return null;
}

/** 正在集結的話，回傳集結點 */
export function musterTarget(world: World, f: Faction): Point | null {
  if (f.musterAt === null || f.stance !== 'attack') return null;
  return musterPoint(world, f);
}

/** 每秒檢查一次集結：人到齊或等太久就出發；AI 也會在適當時機發動戰術指令 */
export function updateTactics(world: World): void {
  if (world.tick % TICKS_PER_SECOND) return;
  for (const f of world.factions) {
    if (!f.alive || f.neutral) continue;
    if (f.musterAt !== null) {
      const p = musterTarget(world, f);
      const warriors = fieldWarriors(world, f);
      const ready = p ? warriors.filter((u) => dist(u.x, u.y, p.x, p.y) <= MUSTER_RADIUS).length : 0;
      const timeUp = world.tick - f.musterAt >= MUSTER_MAX_SECONDS * TICKS_PER_SECOND;
      if (!p || timeUp || ready >= Math.max(1, warriors.length * MUSTER_SHARE)) {
        f.musterAt = null;
        if (p && f.playerControlled) logEvent(world, 'combat', `${f.name} 大軍集結完畢（${ready} 人），全軍出擊！`, f.id);
      }
    }
    if (!f.playerControlled && f.useAbilities) aiAbilities(world, f);
  }
}

/** AI 的戰術指令：家被圍就舉盾，大軍壓到敵方建築旁就吹衝鋒號 */
function aiAbilities(world: World, f: Faction): void {
  const hq = hqOf(world, f);
  if (!hq) return;
  const c = centerOf(hq);
  if (enemiesNear(world, f.id, c.x, c.y, HQ_THREAT_RADIUS).length >= 4) {
    useAbility(world, f, 'shieldwall');
    return;
  }
  if (f.stance !== 'attack' || f.targetFaction === null || world.factions[f.targetFaction].neutral) return;
  const targets = factionBuildings(world, f.targetFaction);
  const near = fieldWarriors(world, f).filter((u) =>
    targets.some((b) => dist(u.x, u.y, centerOf(b).x, centerOf(b).y) < 8),
  );
  if (near.length >= 5) useAbility(world, f, 'charge');
}
