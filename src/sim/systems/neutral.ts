import { TRAITS, ITEM_DEFS, type ItemDef, type TraitId } from '../items';
import {
  ARTIFACTS, ELIXIR_BONUS, LAIR_DANGER, LEASH, LEGENDARY_BASES, MONSTERS, RELIC_IDS, treasureLabel,
  type Lair, type MonsterKind, type RelicId, type Treasure,
} from '../lairs';
import { ATTR_KEYS, ATTR_LABELS, RACES } from '../races';
import { maxHpOf } from '../stats';
import type { MapResult } from '../map';
import { dist } from '../math';
import type { AttrKey, Faction, Point, Unit, UnitAction, World } from '../types';
import { areHostile, getBuilding, isTargetable, logEvent, spawnUnit } from '../util';

// ───────────── 建立巢穴 ─────────────

function spawnGuardian(world: World, beast: Faction, kind: MonsterKind, home: Point, i: number): Unit | null {
  const def = MONSTERS[kind];
  const angle = (i / def.count) * Math.PI * 2;
  const at = { x: home.x + Math.cos(angle) * 1.6, y: home.y + Math.sin(angle) * 1.6 };
  const u = spawnUnit(world, beast, 'warrior', 'soldier', at);
  if (!u) return null;
  u.attrs = { ...def.attrs };
  u.hp = u.maxHp = def.hp;
  u.name = def.name;
  u.monster = kind;
  u.home = { ...home };
  u.morale = 100;
  u.loyalty = 100;
  u.weapon = { id: world.nextId++, defId: def.weapon.id, quality: 1, maker: '天生', custom: def.weapon };
  const hide: ItemDef = { ...ITEM_DEFS.leather, id: `monster:${kind}:hide`, name: `${def.name}的外皮`, armor: def.armor, inventor: '天生' };
  u.armor = { id: world.nextId++, defId: hide.id, quality: 1, maker: '天生', custom: hide };
  return u;
}

/** 在四個象限與地圖中央放置巢穴與守衛，並隨機分配寶藏 */
export function setupLairs(world: World, beast: Faction, map: MapResult, createLair: (x: number, y: number) => number): void {
  const rng = world.rng;
  let kinds: MonsterKind[] = rng.shuffle(['wolf', 'golem', 'treant', rng.pick(['wolf', 'golem', 'treant'] as MonsterKind[])]);
  // 1v1 地圖：對稱的兩座巢穴守衛相同、寶藏種類相同，雙方才公平
  const pairRolls = map.pairedLairs ? [rng.int(0, 3), rng.int(0, 3)] : null;
  if (map.pairedLairs) kinds = [kinds[0], kinds[1], kinds[0], kinds[1]];
  const relics = rng.shuffle([...RELIC_IDS]);
  const artifacts = rng.shuffle([...ARTIFACTS]);
  const bases = rng.shuffle([...LEGENDARY_BASES]);
  // 神器獨一無二：先保留一件給巨龍，其餘發完就改給秘術
  const dragonArtifact = artifacts.pop()!;

  const place = (spot: Point, kind: MonsterKind, treasure: Treasure) => {
    const buildingId = createLair(spot.x, spot.y);
    const center = { x: spot.x + 1, y: spot.y + 1 };
    const lair: Lair = { buildingId, name: MONSTERS[kind].lairName, monster: kind, treasure, center, claimedBy: null };
    world.lairs.push(lair);
    for (let i = 0; i < MONSTERS[kind].count; i++) spawnGuardian(world, beast, kind, center, i);
  };

  map.lairSpots.forEach((spot, i) => {
    const roll = pairRolls ? pairRolls[i % 2] : rng.int(0, 3);
    const treasure: Treasure =
      roll === 1 && artifacts.length ? { type: 'artifact', item: artifacts.pop()! }
        : roll === 2 ? { type: 'blueprint', baseId: bases.pop() ?? 'steelBlade' }
          : roll === 3 ? { type: 'elixir' }
            : { type: 'relic', relic: relics.pop()! };
    place(spot, kinds[i], treasure);
  });
  place(map.dragonSpot, 'dragon', {
    type: 'hoard',
    artifact: dragonArtifact,
    relic: relics.pop() ?? 'war',
  });
}

// ───────────── 守衛 AI ─────────────

/** 守衛只在巢穴附近活動：有人闖進地盤就攻擊，追太遠就回家 */
export function guardianThink(world: World, u: Unit): void {
  const home = u.home;
  if (!home) return;
  let target: Unit | null = null;
  // 偵測範圍比追擊範圍大一些，遠程單位沒辦法在邊緣白白放箭
  let bestD = LEASH + 3;
  for (const e of world.units) {
    if (!isTargetable(e, u.x, u.y) || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(e.x, e.y, home.x, home.y);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  const farFromHome = dist(u.x, u.y, home.x, home.y) > LEASH + 4;
  let action: UnitAction;
  if (target && !farFromHome) action = { type: 'attackUnit', targetId: target.id };
  else action = { type: 'guard', x: home.x + ((u.id % 3) - 1) * 1.2, y: home.y + ((u.id % 2) * 2 - 1) * 1.2 };
  if (action.type !== u.action.type || (action.type === 'attackUnit' && u.action.type === 'attackUnit' && action.targetId !== u.action.targetId)) {
    u.action = action;
    u.path.length = 0;
    u.pathGoal = null;
  }
}

/** 沒人打擾時，守衛慢慢回血 */
export function guardianRegen(world: World, u: Unit): void {
  if (!u.home) return;
  const threatened = world.units.some(
    (e) => e.hp > 0 && areHostile(world, u.factionId, e.factionId) && dist(e.x, e.y, u.home!.x, u.home!.y) < LEASH,
  );
  if (!threatened) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.002);
}

// ───────────── 攻陷與寶藏 ─────────────

export function activeLairs(world: World): Lair[] {
  return world.lairs.filter((l) => l.claimedBy === null && getBuilding(world, l.buildingId));
}

export function lairOfBuilding(world: World, buildingId: number): Lair | undefined {
  return world.lairs.find((l) => l.buildingId === buildingId);
}

export function guardiansOf(world: World, lair: Lair): Unit[] {
  return world.units.filter((u) => u.hp > 0 && u.home && u.home.x === lair.center.x && u.home.y === lair.center.y);
}

/** 工人不敢去還有怪物守著的礦脈 */
export function inLairDanger(world: World, x: number, y: number): boolean {
  return activeLairs(world).some((l) => dist(l.center.x, l.center.y, x, y) < LAIR_DANGER);
}

/** 上古圖紙：威力 ×1.7、兩種特效的傳說藍圖 */
export function legendaryBlueprint(world: World, f: Faction, baseId: string): ItemDef {
  const base = ITEM_DEFS[baseId];
  const pool: TraitId[] = base.slot === 'weapon' ? ['venom', 'flame', 'pierce', 'swift'] : ['sturdy', 'blessed'];
  const traits = world.rng.shuffle([...pool]).slice(0, 2);
  const mult = 1.7;
  return {
    ...base,
    id: `bp:${f.id}:${world.nextId++}`,
    name: `上古${traits.map((t) => TRAITS[t].adj).join('')}${base.name}`,
    dmg: base.dmg * mult,
    armor: base.armor * mult * (traits.includes('sturdy') ? 1.3 : 1),
    onlyRace: undefined,
    traits,
    inventor: '上古工匠',
    baseId,
    powerMult: mult,
  };
}

function grantArtifact(world: World, f: Faction, item: ItemDef) {
  f.armory.push({ id: world.nextId++, defId: item.id, quality: 1.2, maker: '遠古', custom: item });
}

function grantRelic(f: Faction, relic: RelicId) {
  if (!f.relics.includes(relic)) f.relics.push(relic);
}

/** 陣營目前最弱的屬性（種族基礎值＋已得到的秘藥加成） */
export function weakestAttr(f: Faction): AttrKey {
  const base = RACES[f.race].base;
  return ATTR_KEYS.reduce((a, b) => (base[b] + f.attrBonus[b] < base[a] + f.attrBonus[a] ? b : a));
}

/** 賢者秘藥：最弱的屬性永久提升，現有族人立刻生效，之後出生的也有 */
export function grantElixir(world: World, f: Faction): AttrKey {
  const k = weakestAttr(f);
  f.attrBonus[k] += ELIXIR_BONUS;
  for (const u of world.units) {
    if (u.factionId !== f.id || u.hp <= 0 || u.monster) continue;
    u.attrs[k] += ELIXIR_BONUS;
    if (k === 'con') {
      const maxHp = maxHpOf(u.attrs);
      u.hp += maxHp - u.maxHp;
      u.maxHp = maxHp;
    }
  }
  return k;
}

/** 巢穴被攻陷：最後一擊的陣營奪得寶藏，殘存守衛潰散，礦脈開放 */
export function claimLair(world: World, lair: Lair, byFaction: number): void {
  for (const g of guardiansOf(world, lair)) g.hp = 0;
  const f = byFaction >= 0 ? world.factions[byFaction] : null;
  if (!f || f.neutral) {
    lair.claimedBy = -1;
    logEvent(world, 'lair', `「${lair.name}」毀於天災，寶藏散落無蹤`, -1);
  } else {
    lair.claimedBy = f.id;
    const t = lair.treasure;
    if (t.type === 'relic') grantRelic(f, t.relic);
    if (t.type === 'artifact') grantArtifact(world, f, t.item);
    if (t.type === 'blueprint') f.blueprints.push(legendaryBlueprint(world, f, t.baseId));
    if (t.type === 'hoard') {
      grantArtifact(world, f, t.artifact);
      grantRelic(f, t.relic);
    }
    const elixirNote = t.type === 'elixir' ? `：${f.name}全族${ATTR_LABELS[grantElixir(world, f)]} +${ELIXIR_BONUS}` : '';
    logEvent(
      world,
      'lair',
      `🏆 ${f.name} 攻陷了「${lair.name}」，奪得${treasureLabel(t)}${elixirNote}！周圍的遠古礦脈從此開放`,
      f.id,
    );
  }
  const beast = world.factions.find((n) => n.neutral);
  if (beast && activeLairs(world).length === 0) beast.alive = false;
}

/** 陣營是否擁有某個秘術 */
export function hasRelic(world: World, factionId: number, relic: RelicId): boolean {
  return world.factions[factionId]?.relics.includes(relic) ?? false;
}
