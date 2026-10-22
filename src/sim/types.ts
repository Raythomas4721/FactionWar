import type { Rng } from './rng';
import type { WorldRules } from './rules';

export type RaceId = 'orc' | 'elf' | 'dwarf' | 'human';
export type AttrKey = 'str' | 'agi' | 'int' | 'con' | 'cha';
export type Attributes = Record<AttrKey, number>;
export type ResourceKind = 'wood' | 'stone' | 'ore' | 'food';
export type Resources = Record<ResourceKind, number>;
export type Role = 'worker' | 'warrior' | 'smith';
export type TileKind = 'grass' | 'water' | 'forest' | 'rock' | 'ore' | 'berries';
export type BuildingType = 'hq' | 'house' | 'farm' | 'forge' | 'library' | 'barracks' | 'tower';
export type Stance = 'defend' | 'attack';

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
  | { type: 'retreat' };

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
  /** M3（疾病／飢餓）預留，目前未使用 */
  sick: boolean;
  hunger: number;
  /** M4（策反）預留：忠誠度低於門檻會倒戈，目前未使用 */
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
  | { type: 'setStance'; stance: Stance; target: number | null };

export interface FactionStats {
  kills: number;
  deaths: number;
  crafted: number;
  built: number;
  trained: number;
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
  /** M4 外交預留：與各陣營的關係值 -100~100 */
  relations: number[];
  stats: FactionStats;
  nextAiAt: number;
  /** 由玩家決定戰略（進攻／防守），AI 不再改變姿態 */
  playerControlled: boolean;
}

export type EventKind = 'combat' | 'craft' | 'build' | 'tech' | 'faction' | 'god' | 'info';

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
  /** 神力值，施展上帝之手會消耗 */
  mana: number;
}
