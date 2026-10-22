import { ITEM_DEFS, itemPower } from '../items';
import type { Faction, Item, Unit, World } from '../types';
import { centerOf, hqOf } from '../util';
import { moveTo } from './movement';

function currentPower(u: Unit, slot: 'weapon' | 'armor'): number {
  const item = slot === 'weapon' ? u.weapon : u.armor;
  return item ? itemPower(item) : 0;
}

/** 軍械庫中能讓這名戰士變強最多的一件裝備 */
export function bestArmoryUpgrade(f: Faction, u: Unit): { index: number; gain: number } | null {
  let best: { index: number; gain: number } | null = null;
  f.armory.forEach((item, index) => {
    const slot = ITEM_DEFS[item.defId].slot;
    const gain = itemPower(item) - currentPower(u, slot);
    if (gain > 0.5 && (!best || gain > best.gain)) best = { index, gain };
  });
  return best;
}

/** 回營帳換上最好的裝備，舊裝備放回軍械庫給其他人 */
export function equipTick(world: World, u: Unit): boolean {
  const f = world.factions[u.factionId];
  const hq = hqOf(world, f);
  if (!hq) return false;
  const c = centerOf(hq);
  if (!moveTo(world, u, c.x, c.y, 1.6)) return true;
  const up = bestArmoryUpgrade(f, u);
  if (up) {
    const [item] = f.armory.splice(up.index, 1);
    let old: Item | null;
    if (ITEM_DEFS[item.defId].slot === 'weapon') {
      old = u.weapon;
      u.weapon = item;
    } else {
      old = u.armor;
      u.armor = item;
    }
    if (old) f.armory.push(old);
  }
  return false;
}
