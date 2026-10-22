import { RACES } from './races';
import type { BuildingType, RaceId, Resources } from './types';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  glyph: string;
  hp: number;
  cost: Partial<Resources>;
  tech: number;
  /** 建造需要的工作量（1 = 標準） */
  work: number;
  desc: string;
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  hq: { type: 'hq', name: '營帳', glyph: '帳', hp: 800, cost: {}, tech: 0, work: 0,
    desc: '陣營核心：存放資源、訓練小人、治療附近傷兵、射擊來犯者。被攻陷即滅亡。' },
  house: { type: 'house', name: '房屋', glyph: '屋', hp: 150, cost: { wood: 30 }, tech: 0, work: 1,
    desc: '提高人口上限（獸人 +6，其他種族 +5）' },
  farm: { type: 'farm', name: '農田', glyph: '田', hp: 100, cost: { wood: 25 }, tech: 0, work: 0.8,
    desc: '持續產出糧食' },
  forge: { type: 'forge', name: '鍛造坊', glyph: '鍛', hp: 220, cost: { wood: 30, stone: 30 }, tech: 1, work: 1.5,
    desc: '解鎖金屬武器與護甲，打造品質與速度提升' },
  library: { type: 'library', name: '書院', glyph: '書', hp: 160, cost: { wood: 40, stone: 20 }, tech: 1, work: 1.5,
    desc: '研究速度提升（精靈加成更多）' },
  barracks: { type: 'barracks', name: '兵營', glyph: '兵', hp: 260, cost: { wood: 40, stone: 30 }, tech: 1, work: 1.5,
    desc: '訓練戰士的糧食成本 -25%' },
  tower: { type: 'tower', name: '箭塔', glyph: '塔', hp: 320, cost: { stone: 50, wood: 15 }, tech: 2, work: 2,
    desc: '自動射擊附近的敵人' },
  infirmary: { type: 'infirmary', name: '醫館', glyph: '醫', hp: 150, cost: { wood: 30, stone: 15 }, tech: 1, work: 1.2,
    desc: '附近的病患康復速度 ×3，陣營自發染病機率 -40%' },
};

export const HQ_POP = 10;
export const FARM_FOOD_PER_TICK = 0.05;
export const HQ_FOOD_PER_TICK = 0.02;
export const BARRACKS_DISCOUNT = 0.75;

export const TURRETS: Partial<Record<BuildingType, { dmg: number; range: number; cooldown: number }>> = {
  hq: { dmg: 4, range: 5.5, cooldown: 12 },
  tower: { dmg: 6, range: 6.5, cooldown: 12 },
};

/** 套用種族修正後的建造成本（矮人石材 -25%） */
export function buildingCost(type: BuildingType, race: RaceId): Partial<Resources> {
  const cost = { ...BUILDING_DEFS[type].cost };
  if (cost.stone) cost.stone = Math.round(cost.stone * RACES[race].stoneCostMult);
  return cost;
}
