import { TECH_THRESHOLDS, TICKS_PER_SECOND } from './constants';
import { BERRY_MAX, FISH_MAX } from './map';
import { DIFFICULTIES, kingdomOutcome } from './kingdom';
import { RACES, RACE_ORDER, RIVALRY } from './races';
import type { ItemDef } from './items';
import { pickCraftDef } from './systems/crafting';
import { createBuilding, findBuildSpot } from './systems/building';
import { armyPower, fieldArmy } from './strength';
import { getTreaty, initTreaties, setTreaty } from './systems/treaties';
import type { Difficulty, Faction, Item, OutpostKind, Point, RaceId, Tile, TileKind, Unit, World } from './types';
import { logEvent, popCapOf, popOf, spawnUnit } from './util';
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
/** 每個新王國開國時的軍隊戰力，是玩家野戰軍戰力的幾成（依難度） */
const ARMY_POWER: Record<Difficulty, number> = { easy: 0.55, normal: 0.8, hard: 1 };
const MIN_WARRIORS = 5;
const MAX_WARRIORS = 40;
/** 合縱：每隔多久重新評估一次；玩家戰力是最強對手的幾倍時兩國結盟、低於幾倍時拆夥 */
const COALITION_CHECK_TICKS = 30 * TICKS_PER_SECOND;
const COALITION_FORM = 1.5;
const COALITION_BREAK = 1;
/** 同盟成立或破裂後，至少維持多久才會再變 */
const COALITION_LOCK_TICKS = 3 * 60 * TICKS_PER_SECOND;
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
  const prebuilt = ['house', 'house', 'farm', 'farm', 'forge', 'barracks', 'tower'] as const;
  for (const type of prebuilt) {
    const p = findBuildSpot(world, f);
    if (p) createBuilding(world, f, type, p.x, p.y, true);
  }
  for (const role of [...START_ROLES, 'worker', 'worker'] as const) spawnUnit(world, f, role);
  // 軍隊：配上自己科技打得出來的武器與護甲，一直補到戰力達到玩家野戰軍的幾成（看難度）
  const melee = pickCraftDef(f, true, 'weapon', false);
  const bow = pickCraftDef(f, true, 'weapon', true);
  const armor = pickCraftDef(f, true, 'armor');
  const make = (def: ItemDef | null): Item | null =>
    def ? { id: world.nextId++, defId: def.id, quality: 1, maker: '開國工匠', custom: def.inventor ? def : undefined } : null;
  // 用滿血來比：第一章剛打完，玩家的軍隊大多帶傷，很快就會養好
  const theirs = fullHealth(fieldArmy(world, player.id));
  const army: Unit[] = fieldArmy(world, f.id);
  const target = ARMY_POWER[k.difficulty];
  while (army.length < MAX_WARRIORS) {
    if (army.length >= MIN_WARRIORS && powerRatio(fullHealth(army), theirs) >= target) break;
    const u = spawnUnit(world, f, 'warrior');
    if (!u) break;
    const ranged = army.length % 10 < RACES[race].rangedShare * 10;
    u.weapon = make(ranged ? bow ?? melee : melee ?? bow) ?? starterWeapon(world, race);
    u.armor = make(armor);
    army.push(u);
  }
  // 房子要夠住，大臣才補得了兵
  while (popCapOf(world, f.id) < popOf(world, f.id) + 4) {
    const p = findBuildSpot(world, f);
    if (!p) break;
    createBuilding(world, f, 'house', p.x, p.y, true);
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

const fullHealth = (units: Unit[]): Unit[] => units.map((u) => ({ ...u, hp: u.maxHp }));

/** a 對上 b 的戰力比（> 1 表示 a 比較強） */
function powerRatio(a: Unit[], b: Unit[]): number {
  if (!b.length) return Infinity;
  const theirs = armyPower(b, a);
  return theirs > 0 ? armyPower(a, b) / theirs : Infinity;
}

/** 兩個新王國現在是不是同盟 */
export function coalitionOf(world: World): [Faction, Faction] | null {
  const k = world.kingdom;
  if (!k || k.chapter !== 2 || k.rivals.length !== 2) return null;
  const [a, b] = k.rivals.map((id) => world.factions[id]);
  return a.alive && b.alive && getTreaty(world, a.id, b.id) === 'alliance' ? [a, b] : null;
}

/**
 * 合縱：第二章裡玩家一家獨大時，兩個新王國會結盟共抗玩家；
 * 玩家的軍隊被打殘、不再是最大的威脅時，同盟就破裂，兩國又互相攻伐。
 */
export function updateCoalition(world: World): void {
  const k = world.kingdom;
  if (!k || k.chapter !== 2 || k.rivals.length !== 2 || world.over || world.tick % COALITION_CHECK_TICKS !== 0) return;
  const [a, b] = k.rivals.map((id) => world.factions[id]);
  if (!a.alive || !b.alive || world.tick < (k.coalitionLockUntil ?? 0)) return;
  const player = world.factions[k.player];
  const mine = fieldArmy(world, player.id);
  // 玩家對上兩國中比較強的那一個的戰力比
  const ratio = Math.min(powerRatio(mine, fieldArmy(world, a.id)), powerRatio(mine, fieldArmy(world, b.id)));
  const allied = getTreaty(world, a.id, b.id) === 'alliance';
  if (!allied && ratio >= COALITION_FORM) {
    setTreaty(world, a.id, b.id, 'alliance');
    k.coalitionLockUntil = world.tick + COALITION_LOCK_TICKS;
    logEvent(world, 'diplomacy', `🤝 ${player.name}勢大，${a.name}與${b.name}結為同盟，共抗${player.name}！`, -1);
  } else if (allied && ratio < COALITION_BREAK) {
    setTreaty(world, a.id, b.id, 'war');
    k.coalitionLockUntil = world.tick + COALITION_LOCK_TICKS;
    logEvent(world, 'diplomacy', `💔 ${player.name}不再是心腹大患，${a.name}與${b.name}的同盟破裂了`, -1);
  }
}

/** 擴張後的地圖上，新王國的位置（測試與畫面用） */
export function homeOf(world: World, f: Faction): Point | null {
  const hq = world.buildings.find((b) => b.id === f.hqId && b.hp > 0);
  return hq ? { x: hq.x + 1, y: hq.y + 1 } : null;
}

