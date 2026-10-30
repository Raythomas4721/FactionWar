import type { BuildingType, Faction, RaceId, Resources, Troop } from './types';

/** 戰士的兵種。步兵與長矛兵人人可練，其餘是種族專屬。 */
export interface TroopDef {
  id: Troop;
  name: string;
  /** 種族專屬名稱，例如獸人的騎兵叫狼騎兵 */
  raceNames?: Partial<Record<RaceId, string>>;
  races: RaceId[] | 'all';
  tech: number;
  needs?: BuildingType;
  /** 額外的訓練糧食 */
  extraFood: number;
  /** 口糧倍率（騎兵連坐騎一起吃） */
  upkeep: number;
  speedMult: number;
  /** 偏好的武器：遠程、近戰或都可以 */
  weapon: 'ranged' | 'melee' | 'any';
  /** 船隻：只能在海上航行，用木頭與鐵礦打造（不花糧食） */
  naval?: boolean;
  /** 糧食以外的訓練成本 */
  cost?: Partial<Resources>;
  desc: string;
}

export const TROOP_DEFS: Record<Troop, TroopDef> = {
  soldier: {
    id: 'soldier', name: '步兵', races: 'all', tech: 0, extraFood: 0, upkeep: 1, speedMult: 1, weapon: 'any',
    desc: '一般戰士',
  },
  spearman: {
    id: 'spearman', name: '長矛兵', races: 'all', tech: 1, needs: 'barracks', extraFood: 0, upkeep: 1, speedMult: 1,
    weapon: 'melee', desc: '對騎兵傷害 ×2，不會被衝鋒',
  },
  cavalry: {
    id: 'cavalry', name: '騎兵', raceNames: { human: '騎士', orc: '狼騎兵' }, races: ['human', 'orc'], tech: 2,
    needs: 'stable', extraFood: 10, upkeep: 1.5, speedMult: 1.8, weapon: 'melee',
    desc: '速度快；奔跑一段距離後的衝鋒一擊傷害加倍；連坐騎吃 1.5 人份口糧',
  },
  sapper: {
    id: 'sapper', name: '地道工兵', races: ['dwarf'], tech: 2, extraFood: 0, upkeep: 1, speedMult: 1, weapon: 'melee',
    desc: '進攻時從地底挖過去（看不見、打不到、可穿過水域），冒出來拆建築傷害 ×2.5',
  },
  ranger: {
    id: 'ranger', name: '林地伏兵', races: ['elf'], tech: 1, extraFood: 0, upkeep: 1, speedMult: 1, weapon: 'ranged',
    desc: '站在森林裡會隱形，敵人要很靠近才看得見；從暗處放箭傷害 ×1.4',
  },
  ghoul: {
    id: 'ghoul', name: '食屍鬼', races: ['undead'], tech: 1, extraFood: 0, upkeep: 1, speedMult: 1.1, weapon: 'melee',
    desc: '撕咬敵人時吸取生命（造成傷害的 40% 回復自己）',
  },
  scout: {
    id: 'scout', name: '斥候', races: 'all', tech: 0, extraFood: 6, upkeep: 1, speedMult: 1.6, weapon: 'any',
    desc: '跑得快、視野廣（11 格），自動到處偵察、見到敵人就跑；也可以指定偵察地點。不參與戰鬥與佔領',
  },
  transport: {
    id: 'transport', name: '運兵船', races: 'all', tech: 1, needs: 'dock', extraFood: 0, upkeep: 0.5, speedMult: 1,
    weapon: 'any', naval: true, cost: { wood: 70 },
    desc: '一次載 6 名戰士渡海，到敵方海岸搶灘登陸；船沉了乘客也會淹死',
  },
  warship: {
    id: 'warship', name: '戰船', races: 'all', tech: 2, needs: 'dock', extraFood: 0, upkeep: 0.5, speedMult: 1,
    weapon: 'ranged', naval: true, cost: { wood: 90, ore: 25 },
    desc: '船上架著弩砲（射程 5.5），擊沉敵船、轟擊海邊的建築與部隊',
  },
  stinger: {
    id: 'stinger', name: '毒刺蟲', races: ['insect'], tech: 1, extraFood: 0, upkeep: 1, speedMult: 1.1, weapon: 'melee',
    desc: '毒刺命中時可能讓敵人染病',
  },
};

export const TROOP_ORDER: Troop[] = ['soldier', 'spearman', 'cavalry', 'sapper', 'ranger', 'ghoul', 'stinger', 'scout'];

/** 衝鋒：至少要奔跑這麼多格 */
export const CHARGE_DISTANCE = 3;
export const CHARGE_MULT: Partial<Record<RaceId, number>> = { human: 2.5, orc: 2.3 };
export const SPEAR_VS_CAVALRY = 2;
export const SAPPER_VS_BUILDING = 2.5;
export const AMBUSH_MULT = 1.4;
/** 伏兵被發現的距離 */
export const REVEAL_RADIUS = 3.5;
/** 放箭後暴露位置的時間 */
export const REVEAL_TICKS = 45;
export const TUNNEL_SPEED = 0.7;

export function troopName(troop: Troop, race: RaceId): string {
  const def = TROOP_DEFS[troop];
  return def.raceNames?.[race] ?? def.name;
}

export function isTroopAvailableToRace(troop: Troop, race: RaceId): boolean {
  const races = TROOP_DEFS[troop].races;
  return races === 'all' || races.includes(race);
}

/** 科技、建築、種族都符合才能訓練 */
export function canTrainTroop(f: Faction, troop: Troop, hasBuilding: (t: BuildingType) => boolean): boolean {
  const def = TROOP_DEFS[troop];
  return isTroopAvailableToRace(troop, f.race) && f.tech >= def.tech && (!def.needs || hasBuilding(def.needs));
}

/** 各種族希望的兵種比例（其餘為步兵） */
export const TROOP_MIX: Record<RaceId, Partial<Record<Troop, number>>> = {
  human: { cavalry: 0.3, spearman: 0.2 },
  orc: { cavalry: 0.25, spearman: 0.1 },
  elf: { ranger: 0.3, spearman: 0.15 },
  dwarf: { sapper: 0.2, spearman: 0.25 },
  undead: { ghoul: 0.35, spearman: 0.1 },
  insect: { stinger: 0.4 },
  beast: {},
};

/** 食屍鬼吸血比例 */
export const LIFESTEAL = 0.4;
/** 毒刺蟲命中後的染病機率（再乘上目標的染病風險） */
export const STING_INFECT = 0.25;
