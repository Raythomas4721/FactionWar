import { ITEM_DEFS, itemPower, itemSummary, qualityLabel, resolveDef, type ItemDef } from '../items';
import { maybeInvent } from './invention';
import { clamp } from '../math';
import type { Rng } from '../rng';
import { craftRateOf } from '../stats';
import type { Attributes, Faction, Item, RaceId, Unit, World } from '../types';
import {
  canAfford, centerOf, factionBuildings, hasCompleted, hqOf, logEvent, pay, sickMult, unitLabel,
} from '../util';
import { moveTo } from './movement';
import { modOf } from '../modifiers';

export function isItemUnlocked(def: ItemDef, f: Faction, hasForge: boolean): boolean {
  return f.tech >= def.tech && (!def.needsForge || hasForge) && (!def.onlyRace || def.onlyRace === f.race);
}

/**
 * 打造品質的期望值：工匠智慧影響最大，其次是力量、陣營科技、有無鍛造坊、種族專精。
 * 1.0 = 普通品質，傷害／減傷按比例縮放。
 */
export function expectedQuality(smith: Attributes, race: RaceId, tech: number, hasForge: boolean, def: ItemDef): number {
  return (
    0.6 +
    (smith.int - 10) * 0.035 +
    (smith.str - 10) * 0.015 +
    tech * 0.05 +
    (hasForge ? 0.1 : 0) +
    (def.affinity.includes(race) ? 0.2 : 0)
  );
}

export function rollQuality(rng: Rng, smith: Attributes, race: RaceId, tech: number, hasForge: boolean, def: ItemDef): number {
  return clamp(expectedQuality(smith, race, tech, hasForge, def) + rng.range(-0.15, 0.15), 0.3, 2);
}

export function craftWork(def: ItemDef): number {
  return 1 + def.tech * 0.35;
}

/** 陣營目前能做的、該欄位威力最高的裝備（含種族專精加成） */
export function pickCraftDef(f: Faction, hasForge: boolean, slot: 'weapon' | 'armor', ranged?: boolean): ItemDef | null {
  let best: ItemDef | null = null;
  let bestScore = -1;
  for (const def of [...Object.values(ITEM_DEFS), ...f.blueprints]) {
    if (def.slot !== slot || !isItemUnlocked(def, f, hasForge)) continue;
    if (ranged !== undefined && def.ranged !== ranged) continue;
    const score = (slot === 'weapon' ? def.dmg : def.armor) * (def.affinity.includes(f.race) ? 1.2 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = def;
    }
  }
  return best;
}

/** 從佇列中拿第一個付得起的項目開工（當場扣資源） */
export function startCraft(world: World, u: Unit): boolean {
  const f = world.factions[u.factionId];
  const hasForge = hasCompleted(world, f.id, 'forge');
  const idx = f.craftQueue.findIndex((id) => {
    const def = resolveDef(f, id);
    return !!def && isItemUnlocked(def, f, hasForge) && canAfford(f.resources, def.cost);
  });
  if (idx < 0) return false;
  const def = resolveDef(f, f.craftQueue[idx])!;
  f.craftQueue.splice(idx, 1);
  pay(f.resources, def.cost);
  u.action = { type: 'craft', defId: def.id, progress: 0, work: craftWork(def) };
  u.path.length = 0;
  return true;
}

/** 打造被打斷時退還材料、放回佇列 */
export function cancelCraft(world: World, u: Unit): void {
  if (u.action.type !== 'craft') return;
  const f = world.factions[u.factionId];
  const def = resolveDef(f, u.action.defId);
  if (!def) return;
  pay(f.resources, def.cost, -1);
  f.craftQueue.unshift(def.id);
}

export function craftTick(world: World, u: Unit): boolean {
  if (u.action.type !== 'craft') return false;
  const a = u.action;
  const f = world.factions[u.factionId];
  const def = resolveDef(f, a.defId);
  if (!def) return false;
  const forge = factionBuildings(world, f.id, 'forge').find((b) => b.complete);
  const station = forge ?? hqOf(world, f);
  if (!station || (def.needsForge && !forge)) {
    cancelCraft(world, u);
    return false;
  }
  const c = centerOf(station);
  if (!moveTo(world, u, c.x, c.y, 1.6)) return true;

  a.progress += craftRateOf(u.attrs) * (forge ? 1.3 : 1) * sickMult(u);
  if (a.progress < a.work) return true;

  const item: Item = {
    id: world.nextId++,
    defId: def.id,
    quality: rollQuality(world.rng, u.attrs, u.race, f.tech, !!forge, def) * modOf(world, f.id, 'quality'),
    maker: u.name,
    custom: def.inventor ? def : undefined,
  };
  f.armory.push(item);
  f.stats.crafted++;
  const power = itemPower(item);
  if (!f.stats.bestItem || power > f.stats.bestItem.power) {
    f.stats.bestItem = { label: itemSummary(item), power };
  }
  logEvent(world, 'craft', `${unitLabel(u)}（智慧 ${u.attrs.int}）打造了${itemSummary(item)}`, f.id);
  if (qualityLabel(item.quality) === '大師之作') {
    logEvent(world, 'craft', `★ ${f.name}誕生了一件大師之作！`, f.id);
  }
  maybeInvent(world, u, def);
  return false;
}
