import type { Rng } from './rng';
import type { WorldRules } from './rules';

export type RaceId = 'orc' | 'elf' | 'dwarf' | 'human';
export type AttrKey = 'str' | 'agi' | 'int' | 'con' | 'cha';
export type Attributes = Record<AttrKey, number>;
export type ResourceKind = 'wood' | 'stone' | 'ore' | 'food';
export type Resources = Record<ResourceKind, number>;
export type Role = 'worker' | 'warrior' | 'smith' | 'diplomat';
export type TileKind = 'grass' | 'water' | 'forest' | 'rock' | 'ore' | 'berries';
export type BuildingType = 'hq' | 'house' | 'farm' | 'forge' | 'library' | 'barracks' | 'tower' | 'infirmary';
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
  amount: number;
}

export interface Item {
  id: number;
  defId: string;
  quality: number;
  maker: string;
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
  | { type: 'subvert'; targetId: number };

export interface Unit {
  id: number;
  name: string;
  factionId: number;
  race: RaceId;
  role: Role;
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
  carrying: { kind: ResourceKind; amount: number } | null;
  weapon: Item | null;
  armor: Item | null;
  cooldown: number;
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
}

export type Command =
  | { type: 'train'; role: Role }
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
}

export type EventKind = 'combat' | 'craft' | 'build' | 'tech' | 'faction' | 'god' | 'health' | 'diplomacy' | 'info';

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
}
