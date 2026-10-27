import { TRAITS, type ItemDef, type TraitId } from '../items';
import { clamp } from '../math';
import type { Faction, Unit, World } from '../types';
import { hasCompleted, logEvent, unitLabel } from '../util';

/** 每個陣營最多保留幾張藍圖 */
export const MAX_BLUEPRINTS = 6;

const WEAPON_TRAITS: TraitId[] = ['venom', 'flame', 'pierce', 'swift'];
const ARMOR_TRAITS: TraitId[] = ['sturdy', 'blessed'];

/**
 * 每打造完一件裝備，發明新藍圖的機率：
 * 智慧 10 以下想不出新東西，之後每多 1 點智慧 +3.5%，有書院再 ×1.5。
 */
export function inventionChance(world: World, smith: Unit, f: Faction): number {
  const base = Math.max(0, (smith.attrs.int - 10) * 0.035);
  const wisdom = f.relics.includes('wisdom') ? 1.5 : 1;
  return clamp(base * (hasCompleted(world, f.id, 'library') ? 1.5 : 1) * world.rules.inventionMult * wisdom, 0, 0.9);
}

/** 藍圖的威力倍率：越聰明的發明者做出越強的設計 */
export function inventionPower(int: number, roll: number): number {
  return 1.1 + (int - 10) * 0.04 + roll * 0.15;
}

/** 依發明者與基礎裝備生成一張藍圖（不負責登記） */
export function designBlueprint(world: World, inventor: Unit, base: ItemDef): ItemDef {
  const rng = world.rng;
  const int = inventor.attrs.int;
  const powerMult = inventionPower(int, rng.next());
  const pool = rng.shuffle([...(base.slot === 'weapon' ? WEAPON_TRAITS : ARMOR_TRAITS)]);
  const traits = pool.slice(0, int >= 16 ? 2 : 1);
  const armorMult = traits.includes('sturdy') ? 1.3 : 1;
  return {
    ...base,
    id: `bp:${inventor.factionId}:${world.nextId++}`,
    name: `${inventor.name}式${traits.map((t) => TRAITS[t].adj).join('')}${base.name}`,
    dmg: base.dmg * powerMult,
    armor: base.armor * powerMult * armorMult,
    cost: Object.fromEntries(Object.entries(base.cost).map(([k, v]) => [k, Math.ceil((v ?? 0) * 1.3)])),
    traits,
    inventor: inventor.name,
    baseId: base.id,
    powerMult,
  };
}

const powerOf = (d: ItemDef) => (d.slot === 'weapon' ? d.dmg : d.armor);

/** 打造完成後嘗試發明；成功就登記到陣營藍圖並記錄事件 */
export function maybeInvent(world: World, smith: Unit, base: ItemDef): ItemDef | null {
  if (base.inventor) return null; // 藍圖做出來的東西不再衍生
  const f = world.factions[smith.factionId];
  if (!world.rng.chance(inventionChance(world, smith, f))) return null;

  const bp = designBlueprint(world, smith, base);
  const sameBase = f.blueprints.find((b) => b.baseId === base.id);
  if (sameBase && powerOf(sameBase) >= powerOf(bp)) return null;
  if (sameBase) f.blueprints.splice(f.blueprints.indexOf(sameBase), 1);
  if (f.blueprints.length >= MAX_BLUEPRINTS) {
    const weakest = f.blueprints.reduce((a, b) => (powerOf(b) < powerOf(a) ? b : a));
    if (powerOf(weakest) >= powerOf(bp)) return null;
    f.blueprints.splice(f.blueprints.indexOf(weakest), 1);
  }
  f.blueprints.push(bp);
  f.stats.inventions++;
  const traits = bp.traits!.map((t) => `${TRAITS[t].name}：${TRAITS[t].desc}`).join('；');
  logEvent(
    world,
    'invention',
    `💡 ${unitLabel(smith)}（智慧 ${smith.attrs.int}）發明了「${bp.name}」：威力 ×${bp.powerMult!.toFixed(2)}，${traits}`,
    f.id,
  );
  return bp;
}

/** 建築品質：參與建造者的平均智慧越高越好（智慧 10 為標準 ×1，範圍 0.8 ~ 1.3） */
export function buildingQualityOf(avgInt: number): number {
  return clamp(1 + (avgInt - 10) * 0.03, 0.8, 1.3);
}
