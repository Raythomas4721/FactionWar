import { clamp } from './math';
import type { Attributes } from './types';

/** 由屬性推導出的數值。集中在這裡，方便調參與在 UI 上顯示。 */

export const maxHpOf = (a: Attributes): number => Math.round(20 + a.con * 2.5);

/** 每 tick 移動幾格 */
export const speedOf = (a: Attributes): number => 0.08 + a.agi * 0.005;

/** 兩次攻擊之間的 tick 數 */
export const cooldownOf = (a: Attributes): number => Math.max(5, Math.round(13 - a.agi * 0.3));

export const carryOf = (a: Attributes): number => Math.round(8 + a.str * 0.5);

/** 伐木、採石、挖礦看力量；採漿果看力量與敏捷的平均 */
export const gatherRateOf = (a: Attributes, food: boolean): number =>
  food ? 0.1 + ((a.str + a.agi) / 2) * 0.012 : 0.1 + a.str * 0.012;

export const buildRateOf = (a: Attributes): number => 0.003 + a.str * 0.0003;

export const craftRateOf = (a: Attributes): number => 0.004 + a.int * 0.0004;

/** 魅力越高，受傷或目睹同伴死亡時士氣掉得越少 */
export const moraleLossMult = (a: Attributes): number => clamp(1.2 - a.cha * 0.045, 0.4, 1.2);

export const moraleRegenOf = (a: Attributes): number => 0.01 + a.cha * 0.002;

/** 染病機率倍率：體質越高越不容易生病 */
export const diseaseResistOf = (a: Attributes): number => clamp(1.6 - a.con * 0.08, 0.15, 1.2);

/** 每 tick 康復的機率：體質越高好得越快 */
export const recoveryRateOf = (a: Attributes): number => 0.0015 * (1 + a.con / 10);
