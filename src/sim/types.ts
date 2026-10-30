import type { Rng } from './rng';
import type { WorldRules } from './rules';
import type { ItemDef } from './items';
import type { Lair, MonsterKind, RelicId } from './lairs';
import type { HeroPath, TalentId } from './heroes';
import type { ActiveEvent } from './events';
import type { PowerId } from './powers';
import type { PolicyId } from './policies';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** 王國模式（1v1 單機）：玩家選一個王國，對抗一個 AI 陣營 */
export interface KingdomState {
  player: number;
  enemy: number;
  difficulty: Difficulty;
  /** 等待玩家選擇的國策卡（null = 目前沒有） */
  offer: PolicyId[] | null;
  /** 下一次發國策卡的 tick（玩家選完才開始計時） */
  nextPolicyAt: number;
  /** AI 下一次推行國策的 tick */
  aiNextPolicyAt: number;
  /** 雙方推行過的國策（戰報用） */
  history: { factionId: number; policy: PolicyId; tick: number }[];
}

/** 會影響陣營數值的倍率（國策、難度） */
export type ModKey =
  | 'gather' | 'food' | 'research' | 'damage' | 'defense' | 'speed' | 'tower' | 'quality' | 'trainCost' | 'upkeep' | 'xp';

export interface Modifier {
  /** 來源（國策 id 或 difficulty） */
  source: string;
  name: string;
  icon: string;
  mods: Partial<Record<ModKey, number>>;
  /** 到期的 tick（Infinity = 永久） */
  until: number;
  /** 期間不能下令進攻 */
  noAttack?: boolean;
  /** 只是代價／附帶效果，不在介面上單獨列出 */
  hidden?: boolean;
}

/** 進行中的試煉 */
export interface TrialState {
  id: string;
  status: 'running' | 'won' | 'lost';
  reason: string;
  /** 這個試煉允許的神力 */
  powers: PowerId[];
}

/** 英雄：擊殺夠多的戰士晉升而來，有流派、等級、天賦與技能 */
export interface Hero {
  title: string;
  path: HeroPath;
  level: number;
  xp: number;
  talents: TalentId[];
  /** 升級時等待玩家二選一的天賦（AI 陣營會自動選） */
  choice: TalentId[] | null;
  skillCd: number;
  /** 第二技能（W）與大招（E）的冷卻 */
  skill2Cd: number;
  ultCd: number;
  /** 千刃（範圍攻擊）與不死之怒的結束時間 */
  bladeUntil: number;
  undyingUntil: number;
  /** 上次提醒「宿敵出現」的時間 */
  nemesisAlertAt: number;
  summonCd: number;
  /** 被玩家附身操控中 */
  possessed: boolean;
  /** 曾經被玩家附身過（試煉用） */
  everPossessed: boolean;
  /** 「跟隨我」：附近的戰士跟著英雄作戰 */
  rally: boolean;
  /** 連斬數與上次擊殺的時間 */
  streak: number;
  lastKillAt: number;
  nextCrit: boolean;
  rageUntil: number;
  promotedAt: number;
  /** 英雄事蹟 */
  deeds: string[];
}

/** 宿敵：殺死過這個陣營英雄的敵人 */
export interface Nemesis {
  unitId: number;
  factionId: number;
  name: string;
  /** 仇恨值：殺英雄 +50、殺族人 +2 */
  grudge: number;
  /** 被牠殺死的英雄 */
  victims: string[];
  since: number;
}

/** 英雄榜：戰死的英雄 */
export interface Legend {
  name: string;
  title: string;
  factionId: number;
  race: RaceId;
  path: HeroPath;
  level: number;
  kills: number;
  promotedAt: number;
  diedAt: number;
  cause: string;
  deeds: string[];
}

/** beast 為中立怪物，不會出現在參戰種族中 */
export type RaceId = 'orc' | 'elf' | 'dwarf' | 'human' | 'undead' | 'insect' | 'beast';
export type AttrKey = 'str' | 'agi' | 'int' | 'con' | 'cha';
export type Attributes = Record<AttrKey, number>;
export type ResourceKind = 'wood' | 'stone' | 'ore' | 'food';
export type Resources = Record<ResourceKind, number>;
export type Role = 'worker' | 'warrior' | 'smith' | 'diplomat';
/** 戰士的兵種 */
export type Troop = 'soldier' | 'spearman' | 'cavalry' | 'sapper' | 'ranger' | 'ghoul' | 'stinger' | 'scout';
export type TileKind = 'grass' | 'water' | 'forest' | 'rock' | 'ore' | 'berries';
export type BuildingType =
  | 'hq' | 'house' | 'farm' | 'forge' | 'library' | 'barracks' | 'tower' | 'infirmary' | 'stable' | 'lair';
export type Stance = 'defend' | 'attack';
/** 兩個陣營之間的外交狀態 */
export type Treaty = 'war' | 'peace' | 'alliance';
export type Proposal = 'peace' | 'alliance';

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  kind: TileKind;
  /** 資源蘊藏量；水域是魚群（採完會慢慢長回來，漿果也是） */
  amount: number;
}

/** 中立的古地道：兩端入口互通，誰都可以走 */
export interface Tunnel {
  id: number;
  a: Point;
  b: Point;
}

export interface Item {
  id: number;
  defId: string;
  quality: number;
  maker: string;
  /** 依發明藍圖打造的物品自帶定義（倒戈時也會一起帶走） */
  custom?: ItemDef;
}

export type UnitAction =
  | { type: 'idle' }
  | { type: 'gather'; kind: ResourceKind; tx: number; ty: number }
  | { type: 'deliver' }
  | { type: 'build'; buildingId: number }
  | { type: 'craft'; defId: string; progress: number; work: number }
  | { type: 'attackUnit'; targetId: number }
  | { type: 'attackBuilding'; targetId: number }
  | { type: 'equip' }
  | { type: 'guard'; x: number; y: number }
  | { type: 'retreat' }
  /** 出使：前往對方營帳提議停戰或結盟（途中享有外交豁免） */
  | { type: 'envoy'; target: number; proposal: Proposal; returning: boolean }
  /** 策反：接近敵方小人，說服他倒戈 */
  | { type: 'subvert'; targetId: number }
  /** 地道工兵：從地底挖向敵方建築 */
  | { type: 'tunnel'; targetId: number }
  /** 林地伏兵：躲進森林等敵人經過 */
  | { type: 'ambush'; x: number; y: number }
  /** 駐守據點 */
  | { type: 'garrison'; outpostId: number }
  /** 斥候：前往某處偵察 */
  | { type: 'scout'; x: number; y: number };

export interface Unit {
  id: number;
  name: string;
  factionId: number;
  race: RaceId;
  role: Role;
  /** 兵種（非戰士一律為 soldier） */
  troop: Troop;
  attrs: Attributes;
  hp: number;
  maxHp: number;
  morale: number;
  /** 位置（格子座標，浮點數；x+0.5 為格子中心） */
  x: number;
  y: number;
  path: Point[];
  pathGoal: Point | null;
  repathAt: number;
  action: UnitAction;
  thinkAt: number;
  /** 被派去駐守的據點 id */
  post?: number;
  carrying: { kind: ResourceKind; amount: number } | null;
  weapon: Item | null;
  armor: Item | null;
  cooldown: number;
  /** 騎兵累積的奔跑距離，夠長就能衝鋒 */
  charge: number;
  /** 地道工兵在地底 */
  underground: boolean;
  /** 正在古地道裡穿行，到這個 tick 才從出口冒出來 */
  surfaceAt: number;
  /** 林地伏兵隱身中 */
  hidden: boolean;
  /** 放箭後暴露位置到這個 tick */
  revealedUntil: number;
  kills: number;
  bornAt: number;
  /** 是否染病：會掉血、工作與移動變慢、傳染給附近的人 */
  sick: boolean;
  /** 康復後在這個 tick 之前不會再染病 */
  immuneUntil: number;
  /** 飢餓度 0~1：陣營沒糧時上升，過高會掉士氣、掉血 */
  hunger: number;
  /** 忠誠度 0~100：挨餓、生病、士氣低落會下降，越低越容易被策反 */
  loyalty: number;
  /** 中立怪物的種類與守護的家 */
  monster?: MonsterKind;
  home?: Point;
  hero?: Hero;
  /** 身上的劇毒（毒傷流英雄造成） */
  poison?: { stacks: number; until: number; byUnit: number; byFaction: number; potency: number };
  /** 跟隨的英雄 id（「跟隨我」小隊） */
  followHero?: number;
  /** 戰吼／靈魂鏈結：攻速加倍到這個 tick */
  hasteUntil?: number;
  /** 神聖庇護：受到傷害減半到這個 tick */
  shieldUntil?: number;
  /** 召喚物：召喚者 id 與消失時間 */
  summonedBy?: number;
  expiresAt?: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  factionId: number;
  /** 左上角格子，佔 2x2 */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  progress: number;
  complete: boolean;
  cooldown: number;
  /** 建築品質：由參與建造者的平均智慧決定，影響耐久與效果 */
  quality: number;
  /** 建造時累積的（智慧 × 工作量）與工作量，用來算平均智慧 */
  designInt: number;
  designWork: number;
}

export type Command =
  | { type: 'train'; role: Role; troop?: Troop }
  | { type: 'build'; building: BuildingType }
  | { type: 'craft'; defId: string }
  | { type: 'setStance'; stance: Stance; target: number | null }
  | { type: 'propose'; target: number; proposal: Proposal }
  | { type: 'declareWar'; target: number };

export interface FactionStats {
  kills: number;
  deaths: number;
  crafted: number;
  built: number;
  trained: number;
  infections: number;
  diseaseDeaths: number;
  starved: number;
  /** 策反成功招降的人數 */
  recruited: number;
  /** 被敵人策反走的人數 */
  defected: number;
  treaties: number;
  inventions: number;
  /** 晉升過的英雄數 */
  heroes: number;
  /** 手刃宿敵的次數 */
  revenges: number;
  bestItem: { label: string; power: number } | null;
}

export interface Faction {
  id: number;
  race: RaceId;
  name: string;
  color: string;
  resources: Resources;
  research: number;
  tech: number;
  alive: boolean;
  eliminatedAt: number | null;
  stance: Stance;
  targetFaction: number | null;
  hqId: number;
  armory: Item[];
  craftQueue: string[];
  /** 自家發明的裝備藍圖 */
  blueprints: ItemDef[];
  gatherWeights: Resources;
  /** AI 與（未來的）玩家都透過這個佇列下指令 */
  commands: Command[];
  /** 與各陣營的關係值 -100~100 */
  relations: number[];
  nextDiplomacyAt: number;
  stats: FactionStats;
  nextAiAt: number;
  /** 由玩家決定戰略（進攻／防守），AI 不再改變姿態 */
  playerControlled: boolean;
  /** 糧食不夠付這個 tick 的口糧 */
  starving: boolean;
  /** 中立怪物陣營：沒有營帳、不參與勝負與外交 */
  neutral: boolean;
  /** 攻陷巢穴獲得的秘術 */
  relics: RelicId[];
  /** 覆滅的原因（戰報用） */
  fallReason: string | null;
  /** 這個陣營記恨的宿敵 */
  nemeses: Nemesis[];
  /** 賢者秘藥帶來的屬性加成（現有與之後出生的族人都有） */
  attrBonus: Attributes;
  /** 國策與難度帶來的倍率 */
  modifiers: Modifier[];
  /** AI 進攻的積極程度（1 = 標準；越高越早出兵） */
  aggression: number;
  /** AI 會針對對手的兵種調整訓練（困難難度） */
  counterPlay: boolean;
  /** 各據點想要的駐守人數（據點 id → 人數） */
  garrisons: Record<number, number>;
  /** 全軍戰術設定 */
  tactics: Tactics;
  /** 戰術指令冷卻到這個 tick */
  abilityReadyAt: Partial<Record<TacticAbility, number>>;
  /** 正在集結進攻（開始集結的 tick），null = 沒有在集結 */
  musterAt: number | null;
  /** 鳴金收兵：到這個 tick 前戰士一律撤回營帳 */
  recallUntil: number;
  /** AI 會不會自己發動戰術指令 */
  useAbilities: boolean;
  /** 1v1 地圖右邊的陣營：尋路與找資源時用旋轉 180° 的順序，雙方才完全對稱 */
  mirrored?: boolean;
}

export type RetreatTactic = 'cautious' | 'normal' | 'fierce';
export type FocusTactic = 'nearest' | 'weakest' | 'ranged' | 'heroes';
export type TacticAbility = 'charge' | 'shieldwall' | 'recall';

export interface Tactics {
  /** 什麼時候撤退：保守（受傷就回家）、標準、死戰（幾乎不退） */
  retreat: RetreatTactic;
  /** 優先打誰 */
  focus: FocusTactic;
  /** 下令進攻時先在前線集結，人到齊了再一起衝 */
  muster: boolean;
}

export type OutpostKind = 'mine' | 'watchtower' | 'shrine';

/** 地圖上可以佔領的據點：派兵站上去就能佔領，敵人也會來搶 */
export interface Outpost {
  id: number;
  kind: OutpostKind;
  x: number;
  y: number;
  owner: number | null;
  /** 正在佔領的陣營與進度 0~1 */
  capturing: number | null;
  progress: number;
  /** 瞭望塔射擊的冷卻 */
  cooldown: number;
}

/** 戰爭迷霧：只有玩家看得到自己視野內的東西 */
export interface FogState {
  factionId: number;
  /** 每格最後一次被看到的 tick + 1（0 = 從未探索） */
  lastSeen: Int32Array;
  /** 這一刻看得到的格子 */
  visible: Uint8Array;
  /** 每次更新 +1，給畫面判斷要不要重畫 */
  version: number;
  /** 玩家指定的偵察地點 */
  scoutTarget: Point | null;
}

export type EventKind =
  | 'combat' | 'craft' | 'invention' | 'build' | 'tech' | 'faction' | 'god' | 'health' | 'diplomacy' | 'lair' | 'hero'
  | 'world' | 'policy' | 'info';

export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  factionId: number;
}

/** 純視覺效果（箭矢軌跡、神力光環），不影響模擬結果 */
export interface Effect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ttl: number;
  maxTtl: number;
  /** 有半徑時畫成擴散的光環，否則畫成線 */
  radius?: number;
  /** 有文字時畫成往上飄的字（傷害數字、連斬） */
  text?: string;
  size?: number;
  color: string;
}

export interface World {
  seed: number;
  tick: number;
  maxTicks: number;
  rng: Rng;
  width: number;
  height: number;
  tiles: Tile[];
  terrainVersion: number;
  units: Unit[];
  unitMap: Map<number, Unit>;
  buildings: Building[];
  factions: Faction[];
  events: GameEvent[];
  effects: Effect[];
  nextId: number;
  over: boolean;
  winner: number | null;
  endReason: string;
  rules: WorldRules;
  /** 外交狀態矩陣 treaties[a][b]（對稱） */
  treaties: Treaty[][];
  /** 神諭停戰的到期 tick（0 = 不會到期） */
  truceUntil: number[][];
  /** 所有存活陣營全部結盟的起始 tick；維持夠久就是結盟共治勝利 */
  allianceSince: number | null;
  /** 神力值，施展上帝之手會消耗 */
  mana: number;
  /** 中立怪物守護的巢穴 */
  lairs: Lair[];
  /** 英雄榜：戰死的英雄 */
  legends: Legend[];
  /** 進行中的隨機世界事件 */
  activeEvents: ActiveEvent[];
  /** 下一個隨機事件的 tick（0 = 尚未排定） */
  nextEventAt: number;
  /** 造物主的試煉（一般模式為 undefined） */
  trial?: TrialState;
  /** 王國模式（一般模式為 undefined） */
  kingdom?: KingdomState;
  /** 可以佔領的據點 */
  outposts: Outpost[];
  /** 中立古地道 */
  tunnels: Tunnel[];
  /** 戰爭迷霧（只有王國模式） */
  fog?: FogState;
  /** 畫面震動強度（純視覺，附身英雄受重擊時） */
  shake: number;
}
