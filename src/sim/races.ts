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
  /** 每人口糧倍率（0 = 不吃東西） */
  foodUpkeep: number;
  /** 染病機率倍率（再乘上體質抗性；0 = 不會生病） */
  diseaseMult: number;
  /** 希望遠程戰士佔多少比例 */
  rangedShare: number;
  stoneCostMult: number;
  buildSpeed: number;
  /** 每座書院提供的研究加成 */
  libraryBonus: number;
  /** 無所畏懼：士氣永遠全滿，不會因恐懼撤退 */
  fearless: boolean;
  /** 不談判：不培養外交官，也不接受任何提議 */
  noDiplomacy: boolean;
  /** 絕對服從：忠誠度永遠 100，無法被策反 */
  unswayable: boolean;
  /** 壽命（tick），0 = 不會老死 */
  lifespan: number;
  /** 招魂：附近有活人死亡時，化為己方骷髏兵的機率 */
  raiseDead: number;
  /** 吞噬：每殺一人獲得的研究點數與糧食 */
  devour: number;
  /** 怕火：被烈焰武器打中傷害 ×2，祝福反而造成傷害 */
  unholy: boolean;
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

type RaceExtras = Omit<RaceDef, 'id' | 'name' | 'factionName' | 'color' | 'base' | 'names' | 'traits'>;

/** 大部分種族共用的數值，各種族只寫不一樣的部分 */
const STANDARD: RaceExtras = {
  unitCost: 30,
  popPerHouse: 5,
  towerDamageMult: 1,
  maxTowers: 2,
  forageMult: 1,
  foodUpkeep: 1,
  diseaseMult: 1,
  rangedShare: 0.35,
  stoneCostMult: 1,
  buildSpeed: 1,
  libraryBonus: 0.6,
  fearless: false,
  noDiplomacy: false,
  unswayable: false,
  lifespan: 0,
  raiseDead: 0,
  devour: 0,
  unholy: false,
};

export const RACES = {
  orc: {
    ...STANDARD,
    id: 'orc',
    name: '獸人',
    factionName: '獸人部落',
    color: '#8bd450',
    base: { str: 14, agi: 9, int: 6, con: 13, cha: 6 },
    unitCost: 22,
    popPerHouse: 7,
    foodUpkeep: 1.2,
    rangedShare: 0.15,
    names: ['格羅姆', '薩克', '烏佐格', '卡加斯', '杜洛克', '莫格', '拉卡', '戈爾', '納茲', '布魯格'],
    traits: ['訓練便宜、房屋容納更多人口、食量大', '力量與體質高，近戰兇猛', '智慧低科技慢；魅力低，容易被策反', '專屬：狼牙棒、戰斧加成'],
  },
  elf: {
    ...STANDARD,
    id: 'elf',
    name: '精靈',
    factionName: '精靈王國',
    color: '#b98cff',
    base: { str: 7, agi: 14, int: 14, con: 9, cha: 10 },
    unitCost: 52,
    forageMult: 1.2,
    foodUpkeep: 0.8,
    rangedShare: 0.65,
    libraryBonus: 1.0,
    names: ['艾拉爾', '莉拉', '希爾凡', '菲恩', '伊蓮', '塔林', '諾娜', '瑟蘭', '雅文', '璃絲'],
    traits: ['敏捷與智慧高，科技最快', '弓箭專精、擅長採集漿果、食量小', '力量低、體弱易病、人口較貴', '專屬：月影長弓（科技 4）'],
  },
  dwarf: {
    ...STANDARD,
    id: 'dwarf',
    name: '矮人',
    factionName: '矮人氏族',
    color: '#f0a040',
    base: { str: 13, agi: 7, int: 10, con: 15, cha: 6 },
    towerDamageMult: 1.15,
    maxTowers: 3,
    diseaseMult: 0.5,
    rangedShare: 0.2,
    stoneCostMult: 0.75,
    buildSpeed: 1.3,
    names: ['博林', '杜林', '葛林', '索林', '巴爾', '朵莉', '布倫', '甘德', '洛卡', '芬恩'],
    traits: ['體質最高、幾乎不會生病', '石造建築便宜、蓋得快、箭塔更強（最多 3 座）', '戰鎚與重甲打造加成', '專屬：符文戰鎚（科技 4）'],
  },
  human: {
    ...STANDARD,
    id: 'human',
    name: '人類',
    factionName: '人類王國',
    color: '#5a8dff',
    base: { str: 10, agi: 10, int: 10, con: 10, cha: 14 },
    unitCost: 30,
    diseaseMult: 0.8,
    libraryBonus: 0.8,
    names: ['亞瑟', '艾德', '莉亞', '馬可', '湯姆', '珊莎', '羅倫', '凱爾', '貝絲', '奧文'],
    traits: ['各項屬性均衡、比較不容易生病', '魅力高：士氣不易崩潰；書院加成較高', '劍與十字弩打造加成', '外交、策反最強（多培養一名外交官）'],
  },
  undead: {
    ...STANDARD,
    id: 'undead',
    name: '死靈',
    factionName: '死靈軍團',
    color: '#5fd6c0',
    base: { str: 11, agi: 8, int: 11, con: 11, cha: 3 },
    unitCost: 38,
    foodUpkeep: 0,
    diseaseMult: 0,
    rangedShare: 0.25,
    fearless: true,
    noDiplomacy: true,
    unswayable: true,
    raiseDead: 0.33,
    unholy: true,
    names: ['骨嚎', '屍語', '寂滅', '灰燼', '冥火', '腐牙', '夜哭', '墓息', '殘燭', '白骸'],
    traits: ['招魂：附近有活人死去，可能化為己方骷髏兵', '不吃飯、不生病、無所畏懼、無法被策反', '怕火：烈焰武器傷害 ×2，祝福會灼傷牠們', '不與活人談判；專屬：食屍鬼（吸血）'],
  },
  insect: {
    ...STANDARD,
    id: 'insect',
    name: '蟲族',
    factionName: '蟲巢',
    color: '#ff6b8b',
    base: { str: 9, agi: 13, int: 4, con: 8, cha: 3 },
    unitCost: 13,
    popPerHouse: 9,
    foodUpkeep: 0.6,
    diseaseMult: 1.5,
    rangedShare: 0.1,
    buildSpeed: 1.2,
    fearless: true,
    noDiplomacy: true,
    unswayable: true,
    lifespan: 3000,
    devour: 4,
    names: ['刺甲', '嗡鳴', '裂顎', '蛻殼', '腐翅', '尖足', '螯鉗', '巢衛', '蟄針', '幼蛆'],
    traits: ['蟲海：訓練超便宜、巢穴容納大量人口', '壽命短（約 4～5 分鐘），要不斷補充', '吞噬進化：殺敵吃屍獲得研究與糧食，而非靠智慧', '擠在一起易染疫；專屬：毒刺蟲（毒刺使敵人染病）'],
  },
} as Record<RaceId, RaceDef>;

/** 中立怪物（不參戰，只守護巢穴） */
RACES.beast = {
  ...STANDARD,
  id: 'beast',
  name: '怪物',
  factionName: '中立生物',
  color: '#d9534f',
  base: { str: 12, agi: 10, int: 3, con: 12, cha: 1 },
  foodUpkeep: 0,
  diseaseMult: 0,
  fearless: true,
  noDiplomacy: true,
  unswayable: true,
  names: ['怪物'],
  traits: ['守護巢穴與寶藏的中立怪物'],
};

/** 經典四族 */
export const CLASSIC_RACES: RaceId[] = ['orc', 'elf', 'dwarf', 'human'];
export const RACE_ORDER: RaceId[] = ['orc', 'elf', 'dwarf', 'human', 'undead', 'insect'];

/** 種族宿怨：初始關係值，關係也會慢慢回歸到這個基準 */
export const RIVALRY: Record<RaceId, Record<RaceId, number>> = {
  orc: { orc: 0, elf: -30, dwarf: -20, human: -20, undead: -40, insect: -35, beast: -100 },
  elf: { orc: -30, elf: 0, dwarf: -25, human: 10, undead: -60, insect: -40, beast: -100 },
  dwarf: { orc: -20, elf: -25, dwarf: 0, human: 10, undead: -50, insect: -40, beast: -100 },
  human: { orc: -20, elf: 10, dwarf: 10, human: 0, undead: -60, insect: -40, beast: -100 },
  undead: { orc: -40, elf: -60, dwarf: -50, human: -60, undead: 0, insect: -30, beast: -100 },
  insect: { orc: -35, elf: -40, dwarf: -40, human: -40, undead: -30, insect: 0, beast: -100 },
  beast: { orc: -100, elf: -100, dwarf: -100, human: -100, undead: -100, insect: -100, beast: 0 },
};
