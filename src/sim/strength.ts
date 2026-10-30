import { TICKS_PER_SECOND } from './constants';
import { hasTrait } from './items';
import type { Lair } from './lairs';
import { cooldownOf } from './stats';
import { armorOf, hitChance, mitigatedDamage, rawDamage } from './systems/combat';
import { guardiansOf } from './systems/neutral';
import type { Unit, World } from './types';

/**
 * 戰力估算（給玩家看的，不影響模擬）：
 * 用蘭徹斯特平方律——一支部隊的強度 ≈ 總生命 × 總每秒傷害（已扣掉對方的命中與護甲）。
 */

/** a 打 b 的每秒期望傷害 */
export function dpsAgainst(a: Unit, b: Unit): number {
  const dmg = mitigatedDamage(rawDamage(a), b.attrs, armorOf(b), hasTrait(a.weapon, 'pierce'));
  return (hitChance(a.attrs, b.attrs) * dmg * TICKS_PER_SECOND) / cooldownOf(a.attrs);
}

function totalDps(attackers: Unit[], targets: Unit[]): number {
  let sum = 0;
  for (const a of attackers) {
    let d = 0;
    for (const t of targets) d += dpsAgainst(a, t);
    sum += d / targets.length;
  }
  return sum;
}

const totalHp = (units: Unit[]) => units.reduce((s, u) => s + u.hp, 0);

/** 戰力數字：√(總生命 × 總每秒傷害)，人數加倍戰力約加倍 */
export function armyPower(units: Unit[], against: Unit[]): number {
  if (!units.length || !against.length) return 0;
  return Math.sqrt(totalHp(units) * totalDps(units, against));
}

export type OddsLevel = 'sure' | 'good' | 'even' | 'danger';

export interface Odds {
  /** 我方戰力 ÷ 對方戰力 */
  ratio: number;
  mine: number;
  theirs: number;
  level: OddsLevel;
}

export const ODDS_LABEL: Record<OddsLevel, { text: string; color: string; icon: string }> = {
  sure: { text: '穩贏', color: '#6ee06e', icon: '🟢' },
  good: { text: '有勝算', color: '#c6e05a', icon: '🟡' },
  even: { text: '勢均力敵', color: '#f0a040', icon: '🟠' },
  danger: { text: '危險', color: '#ff5a4a', icon: '🔴' },
};

export function battleOdds(mine: Unit[], theirs: Unit[]): Odds {
  const m = armyPower(mine, theirs);
  const t = armyPower(theirs, mine);
  const ratio = t > 0 ? m / t : m > 0 ? Infinity : 0;
  const level: OddsLevel = ratio >= 1.5 ? 'sure' : ratio >= 1.15 ? 'good' : ratio >= 0.85 ? 'even' : 'danger';
  return { ratio, mine: m, theirs: t, level };
}

/** 會出征的部隊：戰士（不含斥候、怪物與召喚物） */
export function fieldArmy(world: World, factionId: number): Unit[] {
  return world.units.filter(
    (u) =>
      u.hp > 0 && u.factionId === factionId && u.role === 'warrior' && u.troop !== 'scout' && !u.monster &&
      u.troop !== 'transport' && u.troop !== 'warship' && u.aboard === undefined,
  );
}

/** 某個陣營全軍去打這座巢穴的勝算 */
export function lairOdds(world: World, factionId: number, lair: Lair): Odds {
  return battleOdds(fieldArmy(world, factionId), guardiansOf(world, lair));
}
