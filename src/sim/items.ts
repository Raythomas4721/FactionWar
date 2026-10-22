import { MELEE_RANGE } from './constants';
import type { Faction, Item, RaceId, Resources } from './types';

/** 發明藍圖附帶的特殊效果 */
export type TraitId = 'venom' | 'flame' | 'pierce' | 'swift' | 'sturdy' | 'blessed';

export const TRAITS: Record<TraitId, { name: string; adj: string; slot: 'weapon' | 'armor'; desc: string }> = {
  venom: { name: '淬毒', adj: '淬毒', slot: 'weapon', desc: '命中時可能讓敵人染病' },
  flame: { name: '烈焰', adj: '烈焰', slot: 'weapon', desc: '對建築傷害 ×2' },
  pierce: { name: '破甲', adj: '破甲', slot: 'weapon', desc: '無視大部分護甲與體質減傷' },
  swift: { name: '輕羽', adj: '輕羽', slot: 'weapon', desc: '攻擊速度 +25%' },
  sturdy: { name: '堅固', adj: '堅固', slot: 'armor', desc: '減傷再 +30%' },
  blessed: { name: '祝聖', adj: '祝聖', slot: 'armor', desc: '穿戴者染病風險減半' },
};

export interface ItemDef {
  id: string;
  name: string;
  slot: 'weapon' | 'armor';
  ranged: boolean;
  dmg: number;
  range: number;
  armor: number;
  cost: Partial<Resources>;
  tech: number;
  needsForge: boolean;
  /** 這些種族打造時品質加成 */
  affinity: RaceId[];
  /** 只有這個種族能打造 */
  onlyRace?: RaceId;
  /** 以下為發明藍圖才有 */
  traits?: TraitId[];
  inventor?: string;
  baseId?: string;
  powerMult?: number;
}

/** 物品的定義：發明出來的物品自帶藍圖，其他查內建表 */
export function itemDef(item: Item): ItemDef {
  return item.custom ?? ITEM_DEFS[item.defId];
}

/** 打造佇列裡的 id：藍圖（bp: 開頭）查陣營自己的藍圖，其他查內建表 */
export function resolveDef(f: Faction, id: string): ItemDef | undefined {
  return id.startsWith('bp:') ? f.blueprints.find((b) => b.id === id) : ITEM_DEFS[id];
}

export function hasTrait(item: Item | null, trait: TraitId): boolean {
  return !!item && !!itemDef(item).traits?.includes(trait);
}

const weapon = (
  id: string,
  name: string,
  dmg: number,
  cost: Partial<Resources>,
  tech: number,
  needsForge: boolean,
  affinity: RaceId[],
  extra: Partial<ItemDef> = {},
): ItemDef => ({
  id, name, slot: 'weapon', ranged: false, dmg, range: MELEE_RANGE, armor: 0,
  cost, tech, needsForge, affinity, ...extra,
});

const bow = (
  id: string,
  name: string,
  dmg: number,
  range: number,
  cost: Partial<Resources>,
  tech: number,
  needsForge: boolean,
  affinity: RaceId[],
  extra: Partial<ItemDef> = {},
): ItemDef => weapon(id, name, dmg, cost, tech, needsForge, affinity, { ranged: true, range, ...extra });

const armor = (
  id: string,
  name: string,
  value: number,
  cost: Partial<Resources>,
  tech: number,
  needsForge: boolean,
  affinity: RaceId[],
): ItemDef => ({
  id, name, slot: 'armor', ranged: false, dmg: 0, range: 0, armor: value,
  cost, tech, needsForge, affinity,
});

export const ITEM_DEFS: Record<string, ItemDef> = {
  club: weapon('club', '木棒', 4, { wood: 6 }, 0, false, []),
  spikedClub: weapon('spikedClub', '狼牙棒', 6, { wood: 6, stone: 3 }, 0, false, ['orc'], { onlyRace: 'orc' }),
  shortbow: bow('shortbow', '短弓', 3.5, 5, { wood: 10 }, 0, false, ['elf']),
  ironSword: weapon('ironSword', '鐵劍', 7, { ore: 6, wood: 2 }, 1, true, ['human']),
  longbow: bow('longbow', '長弓', 5.5, 6.5, { wood: 16 }, 1, false, ['elf']),
  battleAxe: weapon('battleAxe', '戰斧', 9, { ore: 8, wood: 4 }, 2, true, ['orc']),
  warhammer: weapon('warhammer', '戰鎚', 10, { ore: 10, wood: 2 }, 2, true, ['dwarf']),
  crossbow: bow('crossbow', '十字弩', 8, 6, { ore: 6, wood: 8 }, 3, true, ['human', 'dwarf']),
  steelBlade: weapon('steelBlade', '精鋼劍', 12, { ore: 14 }, 3, true, ['human']),
  elvenBow: bow('elvenBow', '月影長弓', 10, 7.5, { wood: 20, ore: 4 }, 4, false, ['elf'], { onlyRace: 'elf' }),
  runeHammer: weapon('runeHammer', '符文戰鎚', 15, { ore: 18, stone: 6 }, 4, true, ['dwarf'], { onlyRace: 'dwarf' }),
  leather: armor('leather', '皮甲', 1.5, { food: 10, wood: 2 }, 0, false, []),
  chainmail: armor('chainmail', '鎖子甲', 3, { ore: 8 }, 2, true, ['dwarf', 'human']),
  plate: armor('plate', '板甲', 5, { ore: 14 }, 3, true, ['dwarf']),
};

export const FIST_DMG = 2;

export function qualityLabel(q: number): string {
  if (q < 0.75) return '粗糙';
  if (q < 1.0) return '普通';
  if (q < 1.25) return '精良';
  if (q < 1.5) return '傑作';
  return '大師之作';
}

/** 實際效果：武器為傷害，護甲為減傷 */
export function itemPower(item: Item): number {
  const def = itemDef(item);
  return (def.slot === 'weapon' ? def.dmg : def.armor) * item.quality;
}

export function itemName(item: Item): string {
  return `【${qualityLabel(item.quality)}】${itemDef(item).name}`;
}

export function itemSummary(item: Item): string {
  const def = itemDef(item);
  const p = itemPower(item).toFixed(1);
  const traits = def.traits?.length ? `｜${def.traits.map((t) => TRAITS[t].name).join('、')}` : '';
  if (def.slot === 'armor') return `${itemName(item)}（減傷 ${p}${traits}）`;
  return `${itemName(item)}（${def.ranged ? '遠程' : '近戰'}傷害 ${p}${traits}）`;
}
