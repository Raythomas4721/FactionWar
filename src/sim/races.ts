import type { AttrKey, Attributes, RaceId } from './types';

export interface RaceDef {
  id: RaceId;
  name: string;
  factionName: string;
  color: string;
  base: Attributes;
  /** 訓練一名小人需要的糧食 */
  unitCost: number;
  /** 每棟房屋增加的人口上限 */
  popPerHouse: number;
  /** 箭塔傷害倍率與最多可蓋幾座 */
  towerDamageMult: number;
  maxTowers: number;
  /** 採集漿果的速度倍率 */
  forageMult: number;
  /** 每人口糧倍率 */
  foodUpkeep: number;
  /** 染病機率倍率（再乘上體質抗性） */
  diseaseMult: number;
  /** 希望遠程戰士佔多少比例 */
  rangedShare: number;
  stoneCostMult: number;
  buildSpeed: number;
  /** 每座書院提供的研究加成 */
  libraryBonus: number;
  names: string[];
  traits: string[];
}

export const ATTR_KEYS: AttrKey[] = ['str', 'agi', 'int', 'con', 'cha'];

export const ATTR_LABELS: Record<AttrKey, string> = {
  str: '力量',
  agi: '敏捷',
  int: '智慧',
  con: '體質',
  cha: '魅力',
};

export const RACES: Record<RaceId, RaceDef> = {
  orc: {
    id: 'orc',
    name: '獸人',
    factionName: '獸人部落',
    color: '#8bd450',
    base: { str: 14, agi: 9, int: 6, con: 13, cha: 6 },
    unitCost: 22,
    popPerHouse: 6,
    towerDamageMult: 1,
    maxTowers: 2,
    forageMult: 1,
    foodUpkeep: 1.2,
    diseaseMult: 1,
    rangedShare: 0.15,
    stoneCostMult: 1,
    buildSpeed: 1,
    libraryBonus: 0.6,
    names: ['格羅姆', '薩克', '烏佐格', '卡加斯', '杜洛克', '莫格', '拉卡', '戈爾', '納茲', '布魯格'],
    traits: ['訓練便宜、房屋容納更多人口、食量大', '力量與體質高，近戰兇猛', '智慧低科技慢；魅力低，容易被策反', '專屬：狼牙棒、戰斧加成'],
  },
  elf: {
    id: 'elf',
    name: '精靈',
    factionName: '精靈王國',
    color: '#b98cff',
    base: { str: 7, agi: 14, int: 14, con: 9, cha: 10 },
    unitCost: 46,
    popPerHouse: 5,
    towerDamageMult: 1,
    maxTowers: 2,
    forageMult: 1.2,
    foodUpkeep: 0.8,
    diseaseMult: 1,
    rangedShare: 0.65,
    stoneCostMult: 1,
    buildSpeed: 1,
    libraryBonus: 1.0,
    names: ['艾拉爾', '莉拉', '希爾凡', '菲恩', '伊蓮', '塔林', '諾娜', '瑟蘭', '雅文', '璃絲'],
    traits: ['敏捷與智慧高，科技最快', '弓箭專精、擅長採集漿果、食量小', '力量低、體弱易病、人口較貴', '專屬：月影長弓（科技 4）'],
  },
  dwarf: {
    id: 'dwarf',
    name: '矮人',
    factionName: '矮人氏族',
    color: '#f0a040',
    base: { str: 13, agi: 7, int: 10, con: 15, cha: 6 },
    unitCost: 30,
    popPerHouse: 5,
    towerDamageMult: 1.25,
    maxTowers: 3,
    forageMult: 1,
    foodUpkeep: 1,
    diseaseMult: 0.5,
    rangedShare: 0.2,
    stoneCostMult: 0.75,
    buildSpeed: 1.3,
    libraryBonus: 0.6,
    names: ['博林', '杜林', '葛林', '索林', '巴爾', '朵莉', '布倫', '甘德', '洛卡', '芬恩'],
    traits: ['體質最高、幾乎不會生病', '石造建築便宜、蓋得快、箭塔更強（最多 3 座）', '戰鎚與重甲打造加成', '專屬：符文戰鎚（科技 4）'],
  },
  human: {
    id: 'human',
    name: '人類',
    factionName: '人類王國',
    color: '#5a8dff',
    base: { str: 10, agi: 10, int: 10, con: 10, cha: 14 },
    unitCost: 30,
    popPerHouse: 5,
    towerDamageMult: 1,
    maxTowers: 2,
    forageMult: 1,
    foodUpkeep: 1,
    diseaseMult: 0.8,
    rangedShare: 0.35,
    stoneCostMult: 1,
    buildSpeed: 1,
    libraryBonus: 0.8,
    names: ['亞瑟', '艾德', '莉亞', '馬可', '湯姆', '珊莎', '羅倫', '凱爾', '貝絲', '奧文'],
    traits: ['各項屬性均衡、比較不容易生病', '魅力高：士氣不易崩潰；書院加成較高', '劍與十字弩打造加成', '外交、策反最強（多培養一名外交官）'],
  },
};

export const RACE_ORDER: RaceId[] = ['orc', 'elf', 'dwarf', 'human'];

/** 種族宿怨：初始關係值，關係也會慢慢回歸到這個基準 */
export const RIVALRY: Record<RaceId, Record<RaceId, number>> = {
  orc: { orc: 0, elf: -30, dwarf: -20, human: -20 },
  elf: { orc: -30, elf: 0, dwarf: -25, human: 10 },
  dwarf: { orc: -20, elf: -25, dwarf: 0, human: 10 },
  human: { orc: -20, elf: 10, dwarf: 10, human: 0 },
};
