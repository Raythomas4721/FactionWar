import { TECH_THRESHOLDS, TICKS_PER_SECOND } from './constants';
import { BERRY_MAX, FISH_MAX } from './map';
import { DIFFICULTIES, kingdomOutcome } from './kingdom';
import { RACES, RACE_ORDER, RIVALRY } from './races';
import type { ItemDef } from './items';
import { pickCraftDef } from './systems/crafting';
import { createBuilding, findBuildSpot } from './systems/building';
import { initTreaties } from './systems/treaties';
import type { Faction, Item, OutpostKind, Point, RaceId, Tile, TileKind, World } from './types';
import { factionUnits, logEvent, spawnUnit } from './util';
import { START_ROLES, createFaction, starterWeapon } from './world';

/**
 * 王國模式第二章：打下第一個王國後，版圖往東、往南擴張，
 * 新的土地上冒出兩個王國，中間隔著一片內海——三國鼎立。
 * 原本的地圖原封不動留在左上角，玩家的部隊、建築、英雄、科技全部保留。
 */

export const EXPANDED_W = 100;
export const EXPANDED_H = 66;
/** 擴張後的休戰時間（新王國不會出兵） */
const PEACE_MINUTES = 3;
/** 擴張後再給多少分鐘 */
const EXTRA_MINUTES = 40;
/** 新王國開國時的兵力：玩家戰士數的幾成 */
const ARMY_SHARE = 0.7;
/** 新興王國的加速持續幾分鐘 */
const UPSTART_MINUTES = 8;

const AMOUNTS: Partial<Record<TileKind, number>> = { forest: 50, rock: 100, ore: 70, berries: BERRY_MAX, water: FISH_MAX };

/** 打贏第一章、還沒擴張過，就可以擴張 */
export function canExpand(world: World): boolean {
  return world.kingdom?.chapter === 1 && kingdomOutcome(world) === 'won';
}

interface ExpansionLayout {
  hqs: Point[];
  outposts: { kind: OutpostKind; x: number; y: number }[];
}

/** 產生新土地：內海、通往玩家家門口的海灣、兩個新王國的根據地與資源 */
function growLand(world: World, oldW: number, oldH: number): ExpansionLayout {
  const W = EXPANDED_W;
  const H = EXPANDED_H;
  const rng = world.rng;
  const rich = world.rules.resourceRichness;
  const tiles: Tile[] = Array.from({ length: W * H }, (_, i) => {
    const x = i % W;
    const y = Math.floor(i / W);
    return x < oldW && y < oldH ? { ...world.tiles[y * oldW + x] } : { kind: 'grass' as TileKind, amount: 0 };
  });
  const isNew = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (x >= oldW || y >= oldH);
  const set = (x: number, y: number, kind: TileKind) => {
    if (isNew(x, y)) tiles[y * W + x] = { kind, amount: Math.round((AMOUNTS[kind] ?? 0) * rich) };
  };

  // 內海：橢圓形，海岸線帶一點起伏
  const sea = { x: 67, y: 50, rx: 20, ry: 9 };
  for (let y = sea.y - sea.ry - 2; y <= sea.y + sea.ry + 2; y++) {
    for (let x = sea.x - sea.rx - 2; x <= sea.x + sea.rx + 2; x++) {
      const n = Math.sin(x * 0.7 + y * 0.3) * 0.08 + Math.sin(y * 1.3 - x * 0.2) * 0.06;
      if (((x - sea.x) / sea.rx) ** 2 + ((y - sea.y) / sea.ry) ** 2 < 1 + n) set(x, y, 'water');
    }
  }
  // 海灣：從內海往西伸到玩家家門口的南邊（西端留一條陸橋）
  for (let x = 14; x < sea.x; x++) {
    const mid = 44 + Math.round(Math.sin(x / 5) * 1.5);
    for (let y = mid - 2; y <= mid + 2; y++) set(x, y, 'water');
  }

  const hqs: Point[] = [
    { x: 89, y: 20 }, // 東方王國
    { x: 30, y: 57 }, // 南方王國
  ];
  const outposts: { kind: OutpostKind; x: number; y: number }[] = [
    { kind: 'mine', x: 74.5, y: 10.5 },
    { kind: 'watchtower', x: 47.5, y: 39.5 },
    { kind: 'shrine', x: 12.5, y: 56.5 },
  ];
  const reserved = [
    ...hqs.map((h) => ({ x: h.x + 1, y: h.y + 1, r: 5 })),
    ...outposts.map((o) => ({ x: o.x, y: o.y, r: 2.2 })),
  ];
  for (const o of outposts) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) set(Math.floor(o.x) + x, Math.floor(o.y) + y, 'grass');
  for (const h of hqs) {
    for (let y = -4; y <= 5; y++) for (let x = -4; x <= 5; x++) if (Math.hypot(x - 0.5, y - 0.5) < 5) set(h.x + x, h.y + y, 'grass');
  }

  const canPlace = (x: number, y: number) =>
    isNew(x, y) && tiles[y * W + x].kind === 'grass' && reserved.every((r) => Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y) > r.r);
  const blob = (cx: number, cy: number, n: number, kind: TileKind) => {
    const cells: Point[] = [];
    if (canPlace(cx, cy)) {
      set(cx, cy, kind);
      cells.push({ x: cx, y: cy });
    }
    for (let tries = 0; cells.length < n && tries < n * 12; tries++) {
      const from = cells.length ? rng.pick(cells) : { x: cx, y: cy };
      const dir = rng.int(0, 3);
      const nx = from.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      const ny = from.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (canPlace(nx, ny)) {
        set(nx, ny, kind);
        cells.push({ x: nx, y: ny });
      }
    }
  };

  // 兩個新王國的根據地：和開局一樣的資源配置
  for (const h of hqs) {
    const toward = h.x > W / 2 ? -1 : 1;
    blob(h.x + 6 * toward, h.y - 3, 6, 'berries');
    blob(h.x + 6 * toward, h.y + 4, 6, 'berries');
    blob(h.x - 2 * toward, h.y - 8, 14, 'forest');
    blob(h.x + 3 * toward, h.y + 8, 14, 'forest');
    blob(h.x - 7 * toward, h.y + 2, 8, 'rock');
    blob(h.x + 9 * toward, h.y - 6, 7, 'ore');
  }
  // 新土地上的森林、石頭、礦脈
  const wild: [number, number, number, TileKind][] = [
    [64, 6, 16, 'forest'], [80, 32, 12, 'forest'], [60, 24, 10, 'rock'], [96, 8, 14, 'forest'],
    [40, 52, 14, 'forest'], [8, 62, 12, 'forest'], [20, 40, 8, 'rock'], [94, 40, 10, 'forest'],
    [70, 18, 6, 'ore'], [52, 60, 7, 'ore'], [88, 60, 12, 'forest'], [6, 48, 8, 'berries'],
  ];
  for (const [x, y, n, kind] of wild) blob(x + rng.int(-2, 2), y + rng.int(-2, 2), n, kind);

  world.width = W;
  world.height = H;
  world.tiles = tiles;
  world.terrainVersion++;
  return { hqs, outposts };
}

/** 迷霧跟著地圖變大：舊的探索紀錄保留，新的土地一片漆黑 */
function growFog(world: World, oldW: number, oldH: number): void {
  const fog = world.fog;
  if (!fog) return;
  const lastSeen = new Int32Array(world.width * world.height);
  const visible = new Uint8Array(world.width * world.height);
  for (let y = 0; y < oldH; y++) {
    for (let x = 0; x < oldW; x++) {
      lastSeen[y * world.width + x] = fog.lastSeen[y * oldW + x];
      visible[y * world.width + x] = fog.visible[y * oldW + x];
    }
  }
  fog.lastSeen = lastSeen;
  fog.visible = visible;
  fog.version++;
}

/** 新王國：起步就有一點家底（科技、建築、軍隊依玩家的實力給） */
function foundKingdom(world: World, race: RaceId, races: RaceId[], spot: Point, player: Faction): Faction {
  const k = world.kingdom!;
  const diff = DIFFICULTIES[k.difficulty];
  const f = createFaction(world, race, races);
  f.hqId = createBuilding(world, f, 'hq', spot.x, spot.y, true).id;
  f.tech = Math.min(4, Math.max(1, player.tech - (k.difficulty === 'easy' ? 1 : 0)));
  f.research = TECH_THRESHOLDS[f.tech];
  f.resources = { wood: 220, stone: 140, ore: 60, food: 160 };
  f.aggression = diff.aggression;
  f.counterPlay = diff.counterPlay;
  f.useAbilities = diff.enemyAbilities;
  f.nextAiAt = world.tick + 1;
  if (Object.keys(diff.enemyMods).length) {
    f.modifiers.push({ source: 'difficulty', name: `難度：${diff.name}`, icon: '🎚', mods: diff.enemyMods, until: Infinity });
  }
  // 新興王國：開國頭幾分鐘採集與研究加快，追上老牌強國
  f.modifiers.push({
    source: 'upstart', name: '新興王國', icon: '🌱', mods: { gather: 1.3, research: 1.3 },
    until: world.tick + UPSTART_MINUTES * 60 * TICKS_PER_SECOND,
  });
  const prebuilt = ['house', 'house', 'farm', 'farm', 'forge', 'barracks'] as const;
  for (const type of prebuilt) {
    const p = findBuildSpot(world, f);
    if (p) createBuilding(world, f, type, p.x, p.y, true);
  }
  // 軍隊：玩家戰士數的七成（至少 5、最多 18），配上自己科技打得出來的武器與護甲
  const playerWarriors = factionUnits(world, player.id).filter((u) => u.role === 'warrior').length;
  const extra = Math.min(18, Math.max(5, Math.round(playerWarriors * ARMY_SHARE)));
  const roles = [...START_ROLES, 'worker', 'worker', ...Array<'warrior'>(extra).fill('warrior')] as const;
  const melee = pickCraftDef(f, true, 'weapon', false);
  const bow = pickCraftDef(f, true, 'weapon', true);
  const armor = pickCraftDef(f, true, 'armor');
  const make = (def: ItemDef | null): Item | null =>
    def ? { id: world.nextId++, defId: def.id, quality: 1, maker: '開國工匠', custom: def.inventor ? def : undefined } : null;
  let n = 0;
  for (const role of roles) {
    const u = spawnUnit(world, f, role);
    if (!u || role !== 'warrior') continue;
    const ranged = n++ % 10 < RACES[race].rangedShare * 10;
    u.weapon = make(ranged ? bow ?? melee : melee ?? bow) ?? starterWeapon(world, race);
    u.armor = make(armor);
  }
  return f;
}

/**
 * 擴張版圖：地圖變大、出現兩個新王國，戰局繼續（第二章）。
 * 回傳新的兩個王國。
 */
export function expandKingdom(world: World): Faction[] {
  const k = world.kingdom;
  if (!k || !canExpand(world)) return [];
  const player = world.factions[k.player];
  const oldW = world.width;
  const oldH = world.height;
  const layout = growLand(world, oldW, oldH);
  growFog(world, oldW, oldH);

  // 兩個新王國：和玩家、第一章的對手都不同的種族
  const used = new Set<RaceId>([player.race, world.factions[k.enemy].race]);
  const pool = world.rng.shuffle(RACE_ORDER.filter((r) => !used.has(r)));
  const newRaces = pool.slice(0, 2);
  const races = [...world.factions.map((f) => f.race), ...newRaces];
  for (const f of world.factions) for (const r of newRaces) f.relations.push(RIVALRY[f.race][r]);
  const founded = newRaces.map((race, i) => foundKingdom(world, race, races, layout.hqs[i], player));
  initTreaties(world);

  for (const o of layout.outposts) {
    world.outposts.push({ id: world.nextId++, kind: o.kind, x: o.x, y: o.y, owner: null, capturing: null, progress: 0, cooldown: 0 });
  }

  k.chapter = 2;
  k.rivals = founded.map((f) => f.id);
  k.peaceUntil = world.tick + PEACE_MINUTES * 60 * TICKS_PER_SECOND;
  k.aiNextPolicyAt = world.tick + 2 * 60 * TICKS_PER_SECOND;
  world.rules.maxMinutes = Math.ceil(world.tick / (60 * TICKS_PER_SECOND)) + EXTRA_MINUTES;
  world.over = false;
  world.winner = null;
  world.endReason = '';
  player.stance = 'defend';
  player.targetFaction = null;
  player.musterAt = null;

  const [east, south] = founded;
  logEvent(world, 'faction', `🌊 版圖擴張！東方崛起了${east.name}，南方崛起了${south.name}，三國鼎立的時代開始了`, -1);
  logEvent(world, 'faction', `🕊 新王國休養生息 ${PEACE_MINUTES} 分鐘；內海可以造船，碼頭蓋好就能渡海登陸`, player.id);
  return founded;
}

/** 擴張後的地圖上，新王國的位置（測試與畫面用） */
export function homeOf(world: World, f: Faction): Point | null {
  const hq = world.buildings.find((b) => b.id === f.hqId && b.hp > 0);
  return hq ? { x: hq.x + 1, y: hq.y + 1 } : null;
}

