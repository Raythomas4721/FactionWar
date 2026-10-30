import { HQ_THREAT_RADIUS, TICKS_PER_SECOND } from './constants';
import { MAX_HEROES } from './heroes';
import type { ItemDef } from './items';
import { RACES } from './races';
import { inPeace } from './rules';
import type { Faction, Item, ModKey, Modifier, RaceId, Resources, Unit, World } from './types';
import {
  areHostile, canAfford, centerOf, contenders, enemiesNear, factionBuildings, factionUnits, hqOf, logEvent, popOf, spawnUnit,
} from './util';
import { completeBuilding } from './systems/building';
import { pickCraftDef } from './systems/crafting';
import { defect } from './systems/diplomacy';
import { choosePath, heroesOf, promote } from './systems/heroSystem';

/**
 * 國策卡：王國模式中每隔幾分鐘從 3 張選 1 張。
 * 每張都有好處也有代價；種族會影響抽到哪些卡。
 */
export type PolicyId =
  | 'levy' | 'forge' | 'blitz' | 'fortify' | 'amnesty' | 'harvest' | 'scholars' | 'bounty'
  | 'corvee' | 'bloodrite' | 'swarm' | 'mercs' | 'raid' | 'song' | 'deepMine';

const MIN = 60 * TICKS_PER_SECOND;
/** 兩次國策之間的間隔 */
export const POLICY_INTERVAL = 4 * MIN;
export const FIRST_POLICY_AT = 1.5 * MIN;
export const POLICY_CHOICES = 3;

export interface PolicyDef {
  id: PolicyId;
  name: string;
  icon: string;
  gain: string;
  cost: string;
  /** 種族抽到這張卡的權重倍率（預設 1） */
  affinity?: Partial<Record<RaceId, number>>;
  /** 這局根本用不到（例如對手無法被策反）就不會抽到 */
  useless?: (world: World, f: Faction) => boolean;
  /** 暫時不能用的原因（資源不夠等） */
  blocked?: (world: World, f: Faction) => string | null;
  apply: (world: World, f: Faction) => void;
}

const needs = (f: Faction, cost: Partial<Resources>, label: string) => (canAfford(f.resources, cost) ? null : `需要${label}`);

function pay(f: Faction, cost: Partial<Resources>): void {
  for (const k of Object.keys(cost) as (keyof Resources)[]) f.resources[k] = Math.max(0, f.resources[k] - (cost[k] ?? 0));
}

function addTimed(world: World, f: Faction, def: PolicyDef, mods: Partial<Record<ModKey, number>>, minutes: number, extra: Partial<Modifier> = {}): void {
  f.modifiers.push({ source: def.id, name: def.name, icon: def.icon, mods, until: world.tick + minutes * MIN, ...extra });
}

/** 王國模式的對手：敵國的對手是玩家，玩家的對手是人最多的敵國（一般模式取第一個敵對陣營） */
export function rivalOf(world: World, f: Faction): Faction | undefined {
  const k = world.kingdom;
  if (k && f.id !== k.player && k.rivals.includes(f.id)) return world.factions[k.player];
  if (k && f.id === k.player) {
    const alive = k.rivals.map((id) => world.factions[id]).filter((r) => r.alive);
    return alive.reduce<Faction | undefined>((a, b) => (!a || popOf(world, b.id) > popOf(world, a.id) ? b : a), undefined) ??
      world.factions[k.enemy];
  }
  return contenders(world).find((o) => o.id !== f.id && areHostile(world, f.id, o.id));
}

/** 王國模式裡還活著的敵國 */
export function aliveRivals(world: World): Faction[] {
  const k = world.kingdom;
  return k ? k.rivals.map((id) => world.factions[id]).filter((f) => f.alive) : [];
}

function warriorsOf(world: World, f: Faction): Unit[] {
  return factionUnits(world, f.id).filter((u) => u.role === 'warrior' && !u.monster && u.summonedBy === undefined);
}

function starter(world: World, f: Faction): Item {
  return { id: world.nextId++, defId: f.race === 'elf' ? 'shortbow' : 'club', quality: 1, maker: '徵召' };
}

/** 傭兵自備的裝備（自家發明的藍圖也要帶上設計） */
function mercItem(world: World, def: ItemDef): Item {
  return { id: world.nextId++, defId: def.id, quality: 1.2, maker: '傭兵', custom: def.inventor ? def : undefined };
}

function setStance(f: Faction, stance: 'attack' | 'defend', target: number | null): void {
  f.commands.push({ type: 'setStance', stance, target });
}

export const POLICIES: Record<PolicyId, PolicyDef> = {
  levy: {
    id: 'levy', name: '全民皆兵', icon: '⚔',
    gain: '立刻徵召 5 名戰士（免費，可超出人口上限）',
    cost: '4 分鐘內所有採集 −30%',
    affinity: { orc: 2, insect: 2 },
    apply: (world, f) => {
      for (let i = 0; i < 5; i++) {
        const u = spawnUnit(world, f, 'warrior');
        if (u) u.weapon = starter(world, f);
      }
      addTimed(world, f, POLICIES.levy, { gather: 0.7 }, 4);
    },
  },
  forge: {
    id: 'forge', name: '鍛造革新', icon: '🔨',
    gain: '之後打造的裝備品質永久 +20%',
    cost: '立刻失去一半的木材與石材',
    affinity: { dwarf: 3, human: 1.5 },
    apply: (world, f) => {
      f.resources.wood = Math.floor(f.resources.wood / 2);
      f.resources.stone = Math.floor(f.resources.stone / 2);
      addTimed(world, f, POLICIES.forge, { quality: 1.2 }, Infinity);
    },
  },
  blitz: {
    id: 'blitz', name: '閃電戰', icon: '⚡',
    gain: '3 分鐘內移動速度 +35%、傷害 +10%，全軍立刻進攻',
    cost: '期間糧食消耗 ×1.6',
    affinity: { orc: 2, human: 1.5 },
    blocked: (world) => (inPeace(world) ? '休戰期間不能發動' : null),
    apply: (world, f) => {
      addTimed(world, f, POLICIES.blitz, { speed: 1.35, damage: 1.1, upkeep: 1.6 }, 3);
      const rival = rivalOf(world, f);
      if (rival) setStance(f, 'attack', rival.id);
    },
  },
  fortify: {
    id: 'fortify', name: '堅壁清野', icon: '🏯',
    gain: '5 分鐘內箭塔傷害 +60%、全軍受到的傷害 −20%',
    cost: '3 分鐘內不能進攻（全軍回防）',
    affinity: { dwarf: 2.5, elf: 1.5 },
    apply: (world, f) => {
      addTimed(world, f, POLICIES.fortify, { tower: 1.6, defense: 0.8 }, 5);
      addTimed(world, f, POLICIES.fortify, {}, 3, { noAttack: true, hidden: true });
      setStance(f, 'defend', null);
    },
  },
  amnesty: {
    id: 'amnesty', name: '招安', icon: '🕊',
    gain: '敵方 3 名忠誠度最低的戰士倒戈（人類 5 名）',
    cost: '花費 80 糧食',
    affinity: { human: 3, elf: 1.2 },
    useless: (world, f) => {
      const rival = rivalOf(world, f);
      return !rival || RACES[rival.race].unswayable;
    },
    blocked: (_w, f) => needs(f, { food: 80 }, ' 80 糧食'),
    apply: (world, f) => {
      pay(f, { food: 80 });
      const rival = rivalOf(world, f);
      const by = factionUnits(world, f.id).find((u) => u.role === 'diplomat') ?? factionUnits(world, f.id)[0];
      if (!rival || !by) return;
      const n = f.race === 'human' ? 5 : 3;
      const targets = warriorsOf(world, rival)
        .filter((u) => !u.hero)
        .sort((a, b) => a.loyalty - b.loyalty)
        .slice(0, n);
      for (const t of targets) defect(world, t, by);
    },
  },
  harvest: {
    id: 'harvest', name: '豐收祭', icon: '🌾',
    gain: '立刻 +150 糧食，4 分鐘內糧食產量 +40%',
    cost: '4 分鐘內研究速度 −40%',
    affinity: { orc: 1.5, insect: 1.5 },
    apply: (world, f) => {
      f.resources.food += 150;
      addTimed(world, f, POLICIES.harvest, { food: 1.4, research: 0.6 }, 4);
    },
  },
  scholars: {
    id: 'scholars', name: '百家爭鳴', icon: '📚',
    gain: '4 分鐘內研究速度 ×1.8',
    cost: '4 分鐘內所有採集 −20%',
    affinity: { elf: 3, human: 1.5 },
    useless: (_w, f) => f.tech >= 4,
    apply: (world, f) => addTimed(world, f, POLICIES.scholars, { research: 1.8, gather: 0.8 }, 4),
  },
  bounty: {
    id: 'bounty', name: '英雄懸賞', icon: '⭐',
    gain: '最強的戰士立刻晉升英雄；5 分鐘內英雄經驗 ×2',
    cost: '花費 100 糧食',
    affinity: { human: 1.5, orc: 1.5 },
    blocked: (_w, f) => needs(f, { food: 100 }, ' 100 糧食'),
    apply: (world, f) => {
      pay(f, { food: 100 });
      if (heroesOf(world, f.id).length < MAX_HEROES) {
        const best = warriorsOf(world, f)
          .filter((u) => !u.hero)
          .sort((a, b) => b.kills - a.kills || b.maxHp - a.maxHp)[0];
        if (best) promote(world, best, choosePath(world, best));
      }
      addTimed(world, f, POLICIES.bounty, { xp: 2 }, 5);
    },
  },
  corvee: {
    id: 'corvee', name: '大興土木', icon: '🏗',
    gain: '所有工地立刻完工',
    cost: '全體士氣 −30',
    affinity: { dwarf: 1.5, human: 1.2 },
    blocked: (world, f) => (factionBuildings(world, f.id).some((b) => !b.complete) ? null : '目前沒有工地'),
    apply: (world, f) => {
      for (const b of factionBuildings(world, f.id)) if (!b.complete) completeBuilding(world, b);
      for (const u of factionUnits(world, f.id)) u.morale = Math.max(0, u.morale - 30);
    },
  },
  bloodrite: {
    id: 'bloodrite', name: '血祭', icon: '🩸',
    gain: '3 分鐘內全軍傷害 +30%',
    cost: '全體立刻失去 25% 生命',
    affinity: { orc: 3, undead: 3 },
    apply: (world, f) => {
      for (const u of factionUnits(world, f.id)) u.hp = Math.max(1, u.hp * 0.75);
      addTimed(world, f, POLICIES.bloodrite, { damage: 1.3 }, 3);
    },
  },
  swarm: {
    id: 'swarm', name: '蟲海戰術', icon: '🐜',
    gain: '4 分鐘內訓練費 −40%',
    cost: '期間糧食消耗 ×1.3',
    affinity: { insect: 3, undead: 1.5, orc: 1.2 },
    apply: (world, f) => addTimed(world, f, POLICIES.swarm, { trainCost: 0.6, upkeep: 1.3 }, 4),
  },
  mercs: {
    id: 'mercs', name: '傭兵團', icon: '💰',
    gain: '3 名配備精良武器與護甲的老兵加入',
    cost: '木 80、石 60、鐵 40',
    affinity: { human: 2.5, dwarf: 1.5 },
    blocked: (_w, f) => needs(f, { wood: 80, stone: 60, ore: 40 }, '木 80、石 60、鐵 40'),
    apply: (world, f) => {
      pay(f, { wood: 80, stone: 60, ore: 40 });
      const weapon = pickCraftDef(f, true, 'weapon', f.race === 'elf');
      const armor = pickCraftDef(f, true, 'armor');
      for (let i = 0; i < 3; i++) {
        const u = spawnUnit(world, f, 'warrior');
        if (!u) continue;
        u.weapon = weapon ? mercItem(world, weapon) : starter(world, f);
        if (armor) u.armor = mercItem(world, armor);
        u.morale = 100;
      }
    },
  },
  raid: {
    id: 'raid', name: '焦土突襲', icon: '🔥',
    gain: '敵國糧倉燒掉 35%，4 分鐘內敵國採集 −15%',
    cost: '全體士氣 −20',
    affinity: { orc: 2, undead: 2 },
    apply: (world, f) => {
      const rival = rivalOf(world, f);
      if (rival) {
        rival.resources.food = Math.floor(rival.resources.food * 0.65);
        addTimed(world, rival, POLICIES.raid, { gather: 0.85 }, 4, { name: '焦土（被突襲）' });
      }
      for (const u of factionUnits(world, f.id)) u.morale = Math.max(0, u.morale - 20);
    },
  },
  song: {
    id: 'song', name: '林中之歌', icon: '🎵',
    gain: '全軍生命與士氣完全回復，疾病痊癒',
    cost: '花費 100 木材',
    affinity: { elf: 3 },
    blocked: (_w, f) => needs(f, { wood: 100 }, ' 100 木材'),
    apply: (world, f) => {
      pay(f, { wood: 100 });
      for (const u of factionUnits(world, f.id)) {
        u.hp = u.maxHp;
        u.morale = 100;
        u.sick = false;
      }
    },
  },
  deepMine: {
    id: 'deepMine', name: '深掘礦脈', icon: '⛏',
    gain: '立刻 +100 石材、+100 鐵礦',
    cost: '4 分鐘內糧食產量 −25%',
    affinity: { dwarf: 3 },
    apply: (world, f) => {
      f.resources.stone += 100;
      f.resources.ore += 100;
      addTimed(world, f, POLICIES.deepMine, { food: 0.75 }, 4);
    },
  },
};

export const POLICY_ORDER = Object.keys(POLICIES) as PolicyId[];

export function policyBlocked(world: World, f: Faction, id: PolicyId): string | null {
  return POLICIES[id].blocked?.(world, f) ?? null;
}

/** 依種族權重抽出幾張不重複的國策卡 */
export function drawPolicies(world: World, f: Faction, n = POLICY_CHOICES): PolicyId[] {
  const pool = POLICY_ORDER.filter((id) => !POLICIES[id].useless?.(world, f));
  const picked: PolicyId[] = [];
  while (picked.length < n && pool.length) {
    const weights = pool.map((id) => POLICIES[id].affinity?.[f.race] ?? 1);
    let r = world.rng.next() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pool.length - 1 && r >= weights[i]) r -= weights[i++];
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

export function enactPolicy(world: World, f: Faction, id: PolicyId): boolean {
  if (policyBlocked(world, f, id)) return false;
  const def = POLICIES[id];
  def.apply(world, f);
  world.kingdom?.history.push({ factionId: f.id, policy: id, tick: world.tick });
  logEvent(world, 'policy', `${def.icon} ${f.name} 推行國策「${def.name}」：${def.gain}（代價：${def.cost}）`, f.id);
  return true;
}

/** 玩家選擇國策（null = 放棄這一輪） */
export function choosePolicy(world: World, id: PolicyId | null): boolean {
  const k = world.kingdom;
  if (!k?.offer) return false;
  const f = world.factions[k.player];
  if (id !== null && (!k.offer.includes(id) || !enactPolicy(world, f, id))) return false;
  k.offer = null;
  k.nextPolicyAt = world.tick + POLICY_INTERVAL;
  return true;
}

/** AI 依局勢挑一張：被圍攻就守、缺糧就種田、正在進攻就加速 */
export function aiPickPolicy(world: World, f: Faction, options: PolicyId[]): PolicyId | null {
  const usable = options.filter((id) => !policyBlocked(world, f, id));
  if (!usable.length) return null;
  const hq = hqOf(world, f);
  const c = hq ? centerOf(hq) : null;
  const threatened = c ? enemiesNear(world, f.id, c.x, c.y, HQ_THREAT_RADIUS).length >= 3 : false;
  const score = (id: PolicyId) => {
    let s = POLICIES[id].affinity?.[f.race] ?? 1;
    if (id === 'fortify' || id === 'song') s *= threatened ? 3 : 0.5;
    if (id === 'harvest' && f.resources.food < 60) s *= 3;
    if ((id === 'blitz' || id === 'bloodrite') && f.stance === 'attack') s *= 2;
    if (id === 'blitz' && threatened) s *= 0.2;
    return s + world.rng.next();
  };
  return usable.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** 移除到期的修正，並提醒玩家 */
function expireModifiers(world: World): void {
  for (const f of world.factions) {
    if (!f.modifiers.length) continue;
    const ended = f.modifiers.filter((x) => x.until <= world.tick);
    if (!ended.length) continue;
    f.modifiers = f.modifiers.filter((x) => x.until > world.tick);
    for (const x of ended) {
      if (!x.hidden) logEvent(world, 'policy', `${x.icon} ${f.name} 的「${x.name}」效果結束`, f.id);
    }
  }
}

/** 王國模式每個 tick：發國策卡給玩家、AI 推行國策 */
export function updateKingdom(world: World): void {
  expireModifiers(world);
  const k = world.kingdom;
  if (!k) return;
  const player = world.factions[k.player];
  if (player.alive && !k.offer && world.tick >= k.nextPolicyAt) {
    k.offer = drawPolicies(world, player);
    logEvent(world, 'policy', '📜 新的國策卡可以選擇了', player.id);
  }
  if (k.difficulty !== 'easy' && world.tick >= k.aiNextPolicyAt) {
    k.aiNextPolicyAt = world.tick + POLICY_INTERVAL;
    for (const enemy of aliveRivals(world)) {
      const pick = aiPickPolicy(world, enemy, drawPolicies(world, enemy));
      if (pick) enactPolicy(world, enemy, pick);
    }
  }
}

/** 讓 AI 自動替玩家陣營選國策（平衡測試用） */
export function autoChoosePolicy(world: World): void {
  const k = world.kingdom;
  if (!k?.offer) return;
  choosePolicy(world, aiPickPolicy(world, world.factions[k.player], k.offer));
}
