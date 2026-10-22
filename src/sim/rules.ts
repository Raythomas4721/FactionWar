import { TICKS_PER_SECOND } from './constants';
import type { RaceId } from './types';

/** 玩家可以調整的世界法則。預設值就是平衡過的標準規則。 */
export interface WorldRules {
  /** 開局休戰（分鐘，遊戲時間） */
  peaceMinutes: number;
  /** 對局時間上限（分鐘），到時以分數判定 */
  maxMinutes: number;
  /** 小人與箭塔造成的傷害倍率 */
  damageMult: number;
  /** 採集速度倍率 */
  gatherMult: number;
  /** 研究速度倍率 */
  researchMult: number;
  /** 地圖資源蘊藏量倍率（新局生效） */
  resourceRichness: number;
  /** 開局科技等級（新局生效） */
  startTech: number;
  /** 各種族新生小人的屬性倍率 */
  racePower: Record<RaceId, number>;
  /** 神力無限 */
  infiniteMana: boolean;
}

export const DEFAULT_RULES: WorldRules = {
  peaceMinutes: 5,
  maxMinutes: 30,
  damageMult: 1,
  gatherMult: 1,
  researchMult: 1,
  resourceRichness: 1,
  startTech: 0,
  racePower: { orc: 1, elf: 1, dwarf: 1, human: 1 },
  infiniteMana: false,
};

export type NumericRuleKey = Exclude<keyof WorldRules, 'racePower' | 'infiniteMana'>;

export interface RuleDef {
  key: NumericRuleKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** false = 只在開新局時生效 */
  live: boolean;
  format: (v: number) => string;
}

const times = (v: number) => `×${v.toFixed(2).replace(/\.?0+$/, '')}`;

export const RULE_DEFS: RuleDef[] = [
  { key: 'peaceMinutes', label: '開局休戰', min: 0, max: 30, step: 1, live: true, format: (v) => (v ? `${v} 分鐘` : '無') },
  { key: 'maxMinutes', label: '對局時限', min: 10, max: 90, step: 5, live: true, format: (v) => `${v} 分鐘` },
  { key: 'damageMult', label: '戰鬥傷害', min: 0.25, max: 3, step: 0.25, live: true, format: times },
  { key: 'gatherMult', label: '採集速度', min: 0.5, max: 3, step: 0.25, live: true, format: times },
  { key: 'researchMult', label: '研究速度', min: 0.5, max: 5, step: 0.25, live: true, format: times },
  { key: 'resourceRichness', label: '資源蘊藏', min: 0.5, max: 3, step: 0.25, live: false, format: times },
  { key: 'startTech', label: '開局科技', min: 0, max: 4, step: 1, live: false, format: (v) => `Lv${v}` },
];

export function mergeRules(partial: Partial<WorldRules> = {}): WorldRules {
  return {
    ...DEFAULT_RULES,
    ...partial,
    racePower: { ...DEFAULT_RULES.racePower, ...partial.racePower },
  };
}

export const maxTicksOf = (rules: WorldRules): number => rules.maxMinutes * 60 * TICKS_PER_SECOND;
export const peaceTicksOf = (rules: WorldRules): number => rules.peaceMinutes * 60 * TICKS_PER_SECOND;
