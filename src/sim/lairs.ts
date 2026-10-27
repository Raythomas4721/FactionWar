import { ITEM_DEFS, type ItemDef } from './items';
import type { Attributes } from './types';

/** 中立怪物的種類 */
export type MonsterKind = 'wolf' | 'golem' | 'treant' | 'dragon';

export interface MonsterDef {
  kind: MonsterKind;
  name: string;
  lairName: string;
  glyph: string;
  count: number;
  attrs: Attributes;
  hp: number;
  weapon: ItemDef;
  armor: number;
}

const claws = (name: string, dmg: number, extra: Partial<ItemDef> = {}): ItemDef => ({
  id: `monster:${name}`, name, slot: 'weapon', ranged: false, dmg, range: 1.3, armor: 0,
  cost: {}, tech: 99, needsForge: false, affinity: [], inventor: '天生', ...extra,
});

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  wolf: {
    kind: 'wolf', name: '巨狼', lairName: '巨狼巢穴', glyph: '狼', count: 4,
    attrs: { str: 13, agi: 15, int: 3, con: 12, cha: 1 }, hp: 110, armor: 2,
    weapon: claws('狼牙', 10),
  },
  golem: {
    kind: 'golem', name: '石像鬼', lairName: '石像鬼神殿', glyph: '石', count: 3,
    attrs: { str: 16, agi: 6, int: 3, con: 18, cha: 1 }, hp: 180, armor: 5,
    weapon: claws('石拳', 12),
  },
  treant: {
    kind: 'treant', name: '古樹守衛', lairName: '古樹聖林', glyph: '樹', count: 3,
    attrs: { str: 16, agi: 5, int: 6, con: 16, cha: 1 }, hp: 190, armor: 4,
    weapon: claws('枝鞭', 12, { range: 1.8 }),
  },
  dragon: {
    kind: 'dragon', name: '遠古巨龍', lairName: '巨龍之巢', glyph: '龍', count: 1,
    attrs: { str: 20, agi: 10, int: 16, con: 20, cha: 1 }, hp: 650, armor: 6,
    weapon: claws('龍息', 20, { ranged: true, range: 4.5, traits: ['flame'] }),
  },
};

/** 秘術：攻陷巢穴後陣營永久獲得的能力 */
export type RelicId = 'war' | 'harvest' | 'wisdom' | 'swift' | 'vitality' | 'iron';

export const RELICS: Record<RelicId, { name: string; desc: string }> = {
  war: { name: '戰神祝福', desc: '全軍傷害 +20%' },
  harvest: { name: '豐饒秘術', desc: '採集與農田產量 +40%' },
  wisdom: { name: '智者之書', desc: '研究速度與發明機率 ×1.5' },
  swift: { name: '疾風秘術', desc: '全軍移動速度 +20%' },
  vitality: { name: '生命之泉', desc: '染病風險 ×0.4，休養回血加倍' },
  iron: { name: '不屈意志', desc: '忠誠 +25，受傷士氣損失減半' },
};
export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

/** 神器：獨一無二的傳說裝備 */
export const ARTIFACTS: ItemDef[] = [
  { ...ITEM_DEFS.steelBlade, id: 'artifact:dragonfang', name: '龍牙劍', dmg: 20, tech: 0, needsForge: false, onlyRace: undefined,
    traits: ['pierce', 'flame'], inventor: '遠古' },
  { ...ITEM_DEFS.longbow, id: 'artifact:worldtree', name: '世界樹之弓', dmg: 15, range: 8, tech: 0, onlyRace: undefined,
    traits: ['swift', 'venom'], inventor: '遠古' },
  { ...ITEM_DEFS.plate, id: 'artifact:aegis', name: '不朽聖盾', armor: 8, tech: 0, needsForge: false,
    traits: ['blessed', 'sturdy'], inventor: '遠古' },
];

/** 上古圖紙的基礎裝備 */
export const LEGENDARY_BASES = ['steelBlade', 'crossbow', 'warhammer', 'plate'];

export type Treasure =
  | { type: 'relic'; relic: RelicId }
  | { type: 'artifact'; item: ItemDef }
  | { type: 'blueprint'; baseId: string }
  | { type: 'hoard'; artifact: ItemDef; relic: RelicId }
  /** 賢者秘藥：補強奪寶陣營最弱的屬性（弱勢種族受益最多，避免寶藏滾雪球） */
  | { type: 'elixir' };

/** 賢者秘藥給的屬性加成 */
export const ELIXIR_BONUS = 4;

export function treasureLabel(t: Treasure): string {
  switch (t.type) {
    case 'elixir': return `賢者秘藥（全族最弱的屬性永久 +${ELIXIR_BONUS}）`;
    case 'relic': return `秘術「${RELICS[t.relic].name}」（${RELICS[t.relic].desc}）`;
    case 'artifact': return `神器「${t.item.name}」`;
    case 'blueprint': return `上古圖紙（${ITEM_DEFS[t.baseId].name}）`;
    case 'hoard': return `龍之寶藏：神器「${t.artifact.name}」與秘術「${RELICS[t.relic].name}」`;
  }
}

/** 巢穴建築上顯示的字：守著什麼 */
export function treasureGlyph(t: Treasure): string {
  return { relic: '秘', artifact: '寶', blueprint: '圖', hoard: '龍', elixir: '藥' }[t.type];
}

export interface Lair {
  /** 巢穴建築的 id */
  buildingId: number;
  name: string;
  monster: MonsterKind;
  treasure: Treasure;
  center: { x: number; y: number };
  claimedBy: number | null;
}

/** 怪物不會追離巢穴超過這個距離 */
export const LEASH = 7;
/** 巢穴未攻陷前，工人不敢靠近這個範圍採集 */
export const LAIR_DANGER = 6;
