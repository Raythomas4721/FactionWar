import { canExpand } from '../sim/expansion';
import type { KingdomSetup } from '../sim/kingdom';
import { deserializeWorld, serializeWorld } from '../sim/save';
import type { World } from '../sim/types';

/** 王國模式自動存檔：存在瀏覽器裡，關掉網頁下次還能接著玩 */

const DATA_KEY = 'factionwar.save';
const META_KEY = 'factionwar.save.meta';

export interface SaveMeta {
  /** 「精靈王國 vs 獸人部落」 */
  title: string;
  chapter: 1 | 2;
  tick: number;
  difficulty: string;
  savedAt: number;
  setup: KingdomSetup | null;
}

export function loadSaveMeta(): SaveMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw && localStorage.getItem(DATA_KEY) ? (JSON.parse(raw) as SaveMeta) : null;
  } catch {
    return null;
  }
}

export function loadSave(): { world: World; meta: SaveMeta } | null {
  try {
    const meta = loadSaveMeta();
    const raw = localStorage.getItem(DATA_KEY);
    const world = raw ? deserializeWorld(raw) : null;
    return meta && world ? { world, meta } : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(META_KEY);
  } catch {
    // 無痕模式時沒有存檔可清
  }
}

/** 只存王國模式；整局結束（又不能再擴張）就把存檔清掉 */
export function autoSave(world: World, setup: KingdomSetup | null): void {
  const k = world.kingdom;
  if (!k || world.trial) return;
  if (world.over && !canExpand(world)) {
    clearSave();
    return;
  }
  const foes = (k.chapter === 2 ? k.rivals : [k.enemy]).map((id) => world.factions[id].name);
  const meta: SaveMeta = {
    title: `${world.factions[k.player].name} vs ${foes.join('、')}`,
    chapter: k.chapter,
    tick: world.tick,
    difficulty: k.difficulty,
    savedAt: Date.now(),
    setup,
  };
  try {
    localStorage.setItem(DATA_KEY, serializeWorld(world));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // 空間不夠或被封鎖時就不存
  }
}
