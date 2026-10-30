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
  /** 染病與傳染機率倍率，0 = 沒有疾病 */
  diseaseMult: number;
  /** 每人口糧倍率，0 = 不用吃飯 */
  upkeepMult: number;
  /** 策反成功率倍率，0 = 不會策反 */
  subvertMult: number;
  /** 發明機率倍率，0 = 不會發明 */
  inventionMult: number;
  /** 所有存活陣營都結盟時，算結盟共治勝利 */
  allianceVictory: boolean;
  /** 地圖上有中立怪物守護寶藏的巢穴（新局生效） */
  neutralLairs: boolean;
  /** 每隔幾分鐘發生隨機世界事件（豐收、寒冬、流星雨…） */
  randomEvents: boolean;
  /** 漿果叢與魚群採完會慢慢長回來（AI 缺糧時也會多開農田） */
  regrowth: boolean;
  /** 地圖資源蘊藏量倍率（新局生效） */
  resourceRichness: number;
  /** 開局科技等級（新局生效） */
  startTech: number;
  /** 各種族新生小人的屬性倍率 */
  racePower: Record<RaceId, number>;
  /** 指定參戰種族（最多 4 個），不足的隨機補上（新局生效） */
  raceSelection: RaceId[];
  /** 神力無限 */
  infiniteMana: boolean;
}

export const DEFAULT_RULES: WorldRules = {
  peaceMinutes: 5,
  maxMinutes: 30,
  damageMult: 1,
  gatherMult: 1,
  researchMult: 1,
  diseaseMult: 1,
  upkeepMult: 1,
  subvertMult: 1,
  inventionMult: 1,
  allianceVictory: true,
  neutralLairs: true,
  randomEvents: true,
  regrowth: false,
  resourceRichness: 1,
  startTech: 0,
  racePower: { orc: 1, elf: 1, dwarf: 1, human: 1, undead: 1, insect: 1, beast: 1 },
  raceSelection: [],
  infiniteMana: false,
};

export type NumericRuleKey = Exclude<
  keyof WorldRules,
  'racePower' | 'raceSelection' | 'infiniteMana' | 'allianceVictory' | 'neutralLairs' | 'randomEvents' | 'regrowth'
>;

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
  { key: 'diseaseMult', label: '疫病強度', min: 0, max: 3, step: 0.25, live: true, format: (v) => (v ? times(v) : '沒有疾病') },
  { key: 'upkeepMult', label: '糧食消耗', min: 0, max: 2, step: 0.25, live: true, format: (v) => (v ? times(v) : '不用吃飯') },
  { key: 'inventionMult', label: '發明頻率', min: 0, max: 3, step: 0.25, live: true, format: (v) => (v ? times(v) : '不會發明') },
  { key: 'subvertMult', label: '策反成功率', min: 0, max: 3, step: 0.25, live: true, format: (v) => (v ? times(v) : '不會策反') },
  { key: 'resourceRichness', label: '資源蘊藏', min: 0.5, max: 3, step: 0.25, live: false, format: times },
  { key: 'startTech', label: '開局科技', min: 0, max: 4, step: 1, live: false, format: (v) => `Lv${v}` },
];

export function mergeRules(partial: Partial<WorldRules> = {}): WorldRules {
  return {
    ...DEFAULT_RULES,
    ...partial,
    racePower: { ...DEFAULT_RULES.racePower, ...partial.racePower },
    raceSelection: [...(partial.raceSelection ?? DEFAULT_RULES.raceSelection)],
  };
}

export const maxTicksOf = (rules: WorldRules): number => rules.maxMinutes * 60 * TICKS_PER_SECOND;
export const peaceTicksOf = (rules: WorldRules): number => rules.peaceMinutes * 60 * TICKS_PER_SECOND;

/** 還在休戰期：開局的休戰，或王國模式擴張後的休養生息 */
export function inPeace(world: { tick: number; rules: WorldRules; kingdom?: { peaceUntil: number } }): boolean {
  return world.tick < peaceTicksOf(world.rules) || world.tick < (world.kingdom?.peaceUntil ?? 0);
}
