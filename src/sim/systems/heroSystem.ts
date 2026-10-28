import {
  AURA_RADIUS, BASE_CRIT_MULT, GENERIC_TALENTS, MAX_HEROES, MAX_LEVEL, PATHS, PATH_AFFINITY, PATH_ORDER,
  POISON_DPS, POISON_TICKS, PROMOTE_KILLS, SUMMON_INTERVAL, SUMMON_LIFETIME, SUMMON_NAMES, TALENTS, VENOM_BURST,
  XP_LEVELS, type HeroPath, type TalentId,
} from '../heroes';
import { dist } from '../math';
import { RACES } from '../races';
import { maxHpOf } from '../stats';
import type { Building, Unit, World } from '../types';
import {
  areHostile, distToBuilding, enemiesNear, isTargetable, logEvent, spawnUnit, unitLabel,
} from '../util';
import { damageUnit } from './combat';

const has = (u: Unit, t: TalentId) => !!u.hero?.talents.includes(t);

export function heroesOf(world: World, factionId: number): Unit[] {
  return world.units.filter((u) => u.hp > 0 && u.hero && u.factionId === factionId);
}

export function heroLabel(u: Unit): string {
  return u.hero ? `${u.name}「${u.hero.title}」` : u.name;
}

function addDeed(u: Unit, world: World, text: string) {
  if (!u.hero) return;
  const m = Math.floor(world.tick / 600);
  u.hero.deeds.push(`${m} 分：${text}`);
  if (u.hero.deeds.length > 10) u.hero.deeds.shift();
}

// ───────────── 晉升 ─────────────

/** 依種族偏好與屬性挑流派：敏捷高偏暴擊、力量高偏狂戰、智慧偏毒或召喚、魅力體質偏守護 */
export function choosePath(world: World, u: Unit): HeroPath {
  const a = u.attrs;
  const fit: Record<HeroPath, number> = {
    crit: a.agi / 10,
    venom: a.int / 10,
    summon: (a.int + a.cha) / 20,
    berserk: a.str / 10,
    guardian: (a.con + a.cha) / 20,
  };
  const aff = PATH_AFFINITY[u.race];
  let best: HeroPath = 'crit';
  let bestScore = -Infinity;
  for (const p of PATH_ORDER) {
    const s = fit[p] + (aff[p] ?? 0) + world.rng.next() * 0.8;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

/** 戰士擊殺數夠多時晉升為英雄（每個陣營最多 MAX_HEROES 名） */
export function maybePromote(world: World, u: Unit): void {
  if (u.hero || u.role !== 'warrior' || u.monster || u.summonedBy !== undefined || u.hp <= 0) return;
  // 短命的種族（蟲族）擊殺 2 人就能晉升精英
  const needed = RACES[u.race].lifespan > 0 ? 2 : PROMOTE_KILLS;
  if (u.kills < needed || heroesOf(world, u.factionId).length >= MAX_HEROES) return;
  promote(world, u, choosePath(world, u));
}

export function promote(world: World, u: Unit, path: HeroPath): void {
  const def = PATHS[path];
  u.hero = {
    title: `${def.title}`,
    path,
    level: 1,
    xp: 0,
    talents: [],
    choice: null,
    skillCd: 0,
    summonCd: SUMMON_INTERVAL / 2,
    possessed: false,
    everPossessed: false,
    rally: false,
    streak: 0,
    lastKillAt: -9999,
    nextCrit: false,
    rageUntil: 0,
    promotedAt: world.tick,
    deeds: [],
  };
  recalcHp(u);
  u.hp = u.maxHp;
  u.morale = 100;
  u.loyalty = 100;
  world.factions[u.factionId].stats.heroes++;
  addDeed(u, world, `擊殺 ${u.kills} 人後晉升為英雄（${def.name}）`);
  logEvent(world, 'hero', `⭐ ${unitLabel(u)} 成為英雄「${def.title}」——${def.icon}${def.name}`, u.factionId);
}

/** 英雄生命上限：屬性基礎 × 晉升 1.2 × 等級 × 流派與天賦 */
export function recalcHp(u: Unit): void {
  const h = u.hero;
  if (!h) return;
  let mult = 1.2 * (1 + (h.level - 1) * 0.05);
  if (h.path === 'crit') mult *= 0.85;
  if (h.path === 'guardian') mult *= 1.2;
  if (has(u, 'glass')) mult *= 0.85;
  if (has(u, 'vigor')) mult *= 1.25;
  const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
  u.maxHp = Math.round(maxHpOf(u.attrs) * mult);
  u.hp = Math.max(1, Math.min(u.maxHp, ratio * u.maxHp));
}

// ───────────── 經驗與天賦 ─────────────

/** 升級時給出的兩個天賦選項：流派天賦優先，混一個通用天賦 */
export function talentOptions(world: World, u: Unit): TalentId[] {
  const h = u.hero!;
  const pathPool = PATHS[h.path].talents.filter((t) => !h.talents.includes(t));
  const genericPool = GENERIC_TALENTS.filter((t) => !h.talents.includes(t));
  const pool = [...world.rng.shuffle([...pathPool]), ...world.rng.shuffle([...genericPool])];
  const first = pool[0];
  const second = pool.find((t, i) => i > 0 && (pathPool.includes(first) ? true : pathPool.includes(t))) ?? pool[1];
  return [first, second].filter((t): t is TalentId => !!t);
}

export function chooseTalent(world: World, u: Unit, talent: TalentId): void {
  const h = u.hero;
  if (!h || !h.choice?.includes(talent)) return;
  h.choice = null;
  h.talents.push(talent);
  recalcHp(u);
  addDeed(u, world, `領悟天賦「${TALENTS[talent].name}」`);
}

/** AI 的選擇：優先拿流派天賦 */
function autoChoose(world: World, u: Unit): void {
  const h = u.hero!;
  if (!h.choice) return;
  const pick = h.choice.find((t) => PATHS[h.path].talents.includes(t)) ?? h.choice[0];
  chooseTalent(world, u, pick);
}

export function gainXp(world: World, u: Unit, xp: number): void {
  const h = u.hero;
  if (!h) return;
  h.xp += xp;
  while (h.level < MAX_LEVEL && h.xp >= XP_LEVELS[h.level + 1]) {
    if (h.choice) autoChoose(world, u);
    h.level++;
    recalcHp(u);
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.3);
    h.choice = talentOptions(world, u);
    const playerDecides = h.possessed || world.factions[u.factionId].playerControlled;
    if (!playerDecides) autoChoose(world, u);
    logEvent(world, 'hero', `⭐ ${heroLabel(u)} 升到 Lv${h.level}${playerDecides ? '，等待你選擇天賦' : ''}`, u.factionId);
  }
}

/** 往上飄的字：傷害數字、連斬（純視覺） */
export function floatText(world: World, x: number, y: number, text: string, color: string, size = 10, ttl = 12): void {
  if (world.effects.length > 400) return;
  world.effects.push({ x1: x, y1: y, x2: x, y2: y, ttl, maxTtl: ttl, color, text, size });
}

const STREAK_WINDOW = 150;
const STREAK_NAMES: Record<number, string> = { 2: '雙殺', 3: '三連斬', 5: '五連斬！', 8: '殺神降臨！' };

/** 英雄短時間內連續擊殺 */
function addStreak(world: World, u: Unit): void {
  const h = u.hero!;
  h.streak = world.tick - h.lastKillAt <= STREAK_WINDOW ? h.streak + 1 : 1;
  h.lastKillAt = world.tick;
  const name = STREAK_NAMES[h.streak];
  if (!name) return;
  floatText(world, u.x, u.y - 1, name, '#ffb347', h.streak >= 5 ? 18 : 14, 24);
  if (h.streak >= 3) {
    addDeed(u, world, `${name}（${h.streak} 連斬）`);
    if (h.streak >= 5 || h.possessed) logEvent(world, 'hero', `🔥 ${heroLabel(u)} ${name}`, u.factionId);
  }
}

/** 擊殺時：英雄（或召喚物的主人）獲得經驗，戰士可能晉升 */
export function onKill(world: World, killer: Unit, victim: Unit): void {
  if (killer.hero) addStreak(world, killer);
  const xp = victim.hero ? 25 : victim.monster ? 30 : 10;
  const owner = killer.summonedBy !== undefined ? world.unitMap.get(killer.summonedBy) : killer;
  if (owner?.hero && owner.hp > 0) {
    gainXp(world, owner, xp);
    if (victim.hero) addDeed(owner, world, `擊殺敵方英雄 ${heroLabel(victim)}`);
    if (victim.monster === 'dragon') addDeed(owner, world, '屠殺遠古巨龍');
  } else if (owner && owner.hp > 0) {
    maybePromote(world, owner);
  }
}

/** 英雄戰死：寫入英雄榜 */
export function onHeroDeath(world: World, u: Unit, cause: string): void {
  const h = u.hero;
  if (!h) return;
  h.possessed = false;
  world.legends.push({
    name: u.name,
    title: h.title,
    factionId: u.factionId,
    race: u.race,
    path: h.path,
    level: h.level,
    kills: u.kills,
    promotedAt: h.promotedAt,
    diedAt: world.tick,
    cause,
    deeds: [...h.deeds],
  });
  logEvent(
    world,
    'hero',
    `🕯 傳奇英雄 ${heroLabel(u)}（Lv${h.level} ${PATHS[h.path].name}，擊殺 ${u.kills}）${cause}`,
    u.factionId,
  );
}

// ───────────── 戰鬥加成與 Combo ─────────────

/** 守護光環：附近有自家守護流英雄時的暴擊與減傷加成 */
export function auraBonus(world: World, u: Unit): { crit: number; armor: number } {
  let crit = 0;
  let armor = 0;
  for (const g of world.units) {
    if (g.hp <= 0 || g.factionId !== u.factionId || g.hero?.path !== 'guardian') continue;
    const r = AURA_RADIUS + (has(g, 'wideAura') ? 2 : 0);
    if (dist(g.x, g.y, u.x, u.y) > r) continue;
    crit = Math.max(crit, 0.1 + (has(g, 'critAura') ? 0.1 : 0));
    armor = Math.max(armor, 2 + (has(g, 'ironAura') ? 2 : 0));
  }
  return { crit, armor };
}

/**
 * 一次攻擊的英雄相關倍率與暴擊判定。
 * Combo：守護光環給暴擊率；暴擊打在中毒的敵人身上觸發「毒爆」。
 */
export function attackModifiers(world: World, u: Unit, target: Unit): { mult: number; crit: boolean } {
  let mult = 1;
  let critChance = auraBonus(world, u).crit;
  let critMult = BASE_CRIT_MULT;
  const h = u.hero;
  if (h) {
    if (h.path === 'crit') critChance += 0.15 + (has(u, 'critChance') ? 0.1 : 0);
    if (has(u, 'critDamage')) critMult += 0.75;
    if (has(u, 'glass')) mult *= 1.25;
    if (has(u, 'power')) mult *= 1.2;
    if (h.path === 'venom') mult *= 0.85;
    if (h.path === 'summon') mult *= 0.7;
    if (h.path === 'guardian') mult *= 0.8;
    if (h.path === 'berserk') mult *= 1 + (1 - u.hp / u.maxHp) * (has(u, 'bloodlust') ? 1.5 : 1);
    if (h.nextCrit) {
      critChance = 1;
      critMult = 3;
      h.nextCrit = false;
    }
  }
  const crit = critChance > 0 && world.rng.chance(critChance);
  if (crit) {
    mult *= critMult;
    if (target.poison) mult *= VENOM_BURST;
  }
  return { mult, crit };
}

/** 攻速倍率（越小越快） */
export function heroCooldownMult(world: World, u: Unit): number {
  let m = 1;
  if (has(u, 'haste')) m *= 0.8;
  if (u.hero && world.tick < u.hero.rageUntil) m *= 0.5;
  return m;
}

export function heroSpeedMult(u: Unit): number {
  return has(u, 'swiftness') ? 1.2 : 1;
}

/** 受到的傷害倍率（不屈） */
export function heroDamageTakenMult(u: Unit): number {
  return has(u, 'unstoppable') && u.hp < u.maxHp * 0.3 ? 0.7 : 1;
}

/** 命中後：毒傷流疊毒、狂戰流吸血 */
export function onHeroHit(world: World, u: Unit, target: Unit, dmg: number): void {
  const h = u.hero;
  if (!h) return;
  if (h.path === 'venom' && target.hp > 0) applyPoison(world, u, target, 1);
  const steal = (world.tick < h.rageUntil ? 0.3 : 0) + (has(u, 'lifesteal') ? 0.2 : 0);
  if (steal > 0) u.hp = Math.min(u.maxHp, u.hp + dmg * steal);
}

export function applyPoison(world: World, by: Unit, target: Unit, stacks: number): void {
  if (RACES[target.race].unholy && by.hero?.path !== 'venom') return;
  const max = 3 + (has(by, 'venomStacks') ? 2 : 0);
  const potency = has(by, 'venomPotency') ? 1.6 : 1;
  const cur = target.poison && world.tick < target.poison.until ? target.poison.stacks : 0;
  target.poison = {
    stacks: Math.min(max, cur + stacks),
    until: world.tick + POISON_TICKS,
    byUnit: by.id,
    byFaction: by.factionId,
    potency,
  };
}

/** 瘟疫散播：中毒的敵人死亡時，毒擴散給附近的敵人 */
export function onPoisonedDeath(world: World, victim: Unit): void {
  const p = victim.poison;
  if (!p || world.tick >= p.until) return;
  const source = world.unitMap.get(p.byUnit);
  if (!source || source.hp <= 0 || !has(source, 'plagueBearer')) return;
  for (const e of world.units) {
    if (e === victim || e.hp <= 0 || !areHostile(world, p.byFaction, e.factionId)) continue;
    if (dist(e.x, e.y, victim.x, victim.y) <= 3) applyPoison(world, source, e, 2);
  }
}

// ───────────── 召喚 ─────────────

export function summon(world: World, hero: Unit): Unit | null {
  const f = world.factions[hero.factionId];
  const u = spawnUnit(world, f, 'warrior', 'soldier', { x: hero.x + world.rng.range(-1, 1), y: hero.y + world.rng.range(-1, 1) });
  if (!u) return null;
  const bonus = has(hero, 'strongSummons') ? 4 : 0;
  u.attrs = { str: 10 + bonus, agi: 10 + bonus, int: 3, con: 10 + bonus, cha: 3 };
  u.hp = u.maxHp = maxHpOf(u.attrs);
  u.name = `${hero.name}的${SUMMON_NAMES[hero.race]}`;
  u.summonedBy = hero.id;
  u.expiresAt = world.tick + SUMMON_LIFETIME * (has(hero, 'longSummons') ? 2 : 1);
  u.loyalty = 100;
  u.morale = 100;
  u.weapon = { id: world.nextId++, defId: 'club', quality: 1, maker: '召喚' };
  return u;
}

const summonsOf = (world: World, hero: Unit) => world.units.filter((s) => s.hp > 0 && s.summonedBy === hero.id);

// ───────────── 技能 ─────────────

export function useSkill(world: World, u: Unit): boolean {
  const h = u.hero;
  if (!h || h.skillCd > 0 || u.hp <= 0) return false;
  const def = PATHS[h.path];
  switch (h.path) {
    case 'crit':
      h.nextCrit = true;
      break;
    case 'venom':
      for (const e of enemiesNear(world, u.factionId, u.x, u.y, 3)) applyPoison(world, u, e, 2);
      break;
    case 'summon':
      summon(world, u);
      summon(world, u);
      break;
    case 'berserk':
      h.rageUntil = world.tick + 150;
      break;
    case 'guardian': {
      const r = AURA_RADIUS + (has(u, 'wideAura') ? 2 : 0);
      for (const a of world.units) {
        if (a.hp <= 0 || a.factionId !== u.factionId || dist(a.x, a.y, u.x, u.y) > r) continue;
        a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.3);
        a.morale = 100;
      }
      break;
    }
  }
  h.skillCd = def.skill.cooldown;
  world.effects.push({ x1: u.x, y1: u.y, x2: u.x, y2: u.y, ttl: 10, maxTtl: 10, radius: 2.5, color: '#ffd75e' });
  if (h.possessed) logEvent(world, 'hero', `⚡ ${heroLabel(u)} 施展「${def.skill.name}」`, u.factionId);
  return true;
}

/** AI 什麼時候放技能 */
function aiWantsSkill(world: World, u: Unit): boolean {
  const h = u.hero!;
  const near = enemiesNear(world, u.factionId, u.x, u.y, h.path === 'summon' ? 7 : 3.5).length;
  if (h.path === 'guardian') {
    const r = AURA_RADIUS;
    const hurt = world.units.filter(
      (a) => a.hp > 0 && a.factionId === u.factionId && dist(a.x, a.y, u.x, u.y) <= r && a.hp < a.maxHp * 0.6,
    ).length;
    return hurt >= 2;
  }
  return near >= (h.path === 'venom' ? 2 : 1);
}

// ───────────── 附身 ─────────────

export function possessedHero(world: World): Unit | undefined {
  return world.units.find((u) => u.hp > 0 && u.hero?.possessed);
}

/** 跟隨我小隊的人數上限與招募範圍 */
export const SQUAD_SIZE = 10;
const SQUAD_RANGE = 8;

export function squadOf(world: World, hero: Unit): Unit[] {
  return world.units.filter((u) => u.hp > 0 && u.followHero === hero.id);
}

/** 開關「跟隨我」：附近的己方戰士加入小隊（一般士兵、不含英雄、怪物與召喚物） */
export function setRally(world: World, hero: Unit, on: boolean): void {
  if (!hero.hero) return;
  hero.hero.rally = on;
  if (!on) {
    for (const u of squadOf(world, hero)) u.followHero = undefined;
    return;
  }
  recruitSquad(world, hero);
  logEvent(world, 'hero', `🚩 ${heroLabel(hero)}：「跟隨我！」${squadOf(world, hero).length} 名戰士集結`, hero.factionId);
}

function recruitSquad(world: World, hero: Unit): void {
  let count = squadOf(world, hero).length;
  const candidates = world.units
    .filter(
      (u) =>
        count < SQUAD_SIZE && u.hp > 0 && u.factionId === hero.factionId && u.role === 'warrior' && !u.hero &&
        !u.monster && u.summonedBy === undefined && u.followHero === undefined &&
        dist(u.x, u.y, hero.x, hero.y) <= SQUAD_RANGE,
    )
    .sort((a, b) => dist(a.x, a.y, hero.x, hero.y) - dist(b.x, b.y, hero.x, hero.y));
  for (const u of candidates) {
    if (count >= SQUAD_SIZE) break;
    u.followHero = hero.id;
    count++;
  }
}

/**
 * 小隊成員的行動：英雄在打誰就一起打，否則在英雄身邊排成陣型跟著走。
 * 回傳 false 代表已不再跟隨（英雄死了或解除附身）。
 */
export function followerThink(world: World, u: Unit): boolean {
  const hero = u.followHero !== undefined ? world.unitMap.get(u.followHero) : undefined;
  if (!hero || hero.hp <= 0 || !hero.hero?.possessed || !hero.hero.rally) {
    u.followHero = undefined;
    return false;
  }
  const ha = hero.action;
  if (ha.type === 'attackUnit' || ha.type === 'attackBuilding') {
    if (u.action.type !== ha.type || (u.action as { targetId: number }).targetId !== ha.targetId) {
      u.action = { ...ha };
      u.path.length = 0;
    }
    return true;
  }
  // 附近有敵人就自己還手
  const foe = enemiesNear(world, u.factionId, u.x, u.y, 2.5)[0];
  if (foe) {
    u.action = { type: 'attackUnit', targetId: foe.id };
    return true;
  }
  // 以英雄為中心排成一圈
  const angle = ((u.id * 137) % 360) * (Math.PI / 180);
  u.action = { type: 'guard', x: hero.x + Math.cos(angle) * 1.8, y: hero.y + Math.sin(angle) * 1.8 };
  return true;
}

export function possess(world: World, u: Unit): void {
  release(world);
  for (const o of world.units) if (o.hero) o.hero.possessed = false;
  if (u.hero && u.hp > 0) {
    u.hero.possessed = true;
    u.hero.everPossessed = true;
  }
}

export function release(world: World): void {
  const u = possessedHero(world);
  if (u?.hero) {
    setRally(world, u, false);
    u.hero.possessed = false;
    if (u.hero.choice) autoChoose(world, u);
  }
}

/** 附身時點地圖下令：點敵人攻擊、點敵方建築攻城、點空地移動 */
export function commandHero(world: World, u: Unit, x: number, y: number): string {
  let target: Unit | undefined;
  let bestD = 1.2;
  for (const e of world.units) {
    if (!isTargetable(e, u.x, u.y) || !areHostile(world, u.factionId, e.factionId)) continue;
    const d = dist(e.x, e.y, x, y);
    if (d < bestD) {
      bestD = d;
      target = e;
    }
  }
  u.path.length = 0;
  u.pathGoal = null;
  if (target) {
    u.action = { type: 'attackUnit', targetId: target.id };
    return `攻擊 ${unitLabel(target)}`;
  }
  const b: Building | undefined = world.buildings.find(
    (bb) => bb.hp > 0 && areHostile(world, u.factionId, bb.factionId) && distToBuilding(x, y, bb) < 0.5,
  );
  if (b) {
    u.action = { type: 'attackBuilding', targetId: b.id };
    return '攻擊建築';
  }
  u.action = { type: 'guard', x, y };
  return '移動';
}

// ───────────── 每個 tick ─────────────

export function updateHeroes(world: World): void {
  for (const u of world.units) {
    if (u.hp <= 0) continue;

    // 劇毒持續傷害
    const p = u.poison;
    if (p) {
      if (world.tick >= p.until) u.poison = undefined;
      else {
        const by = world.unitMap.get(p.byUnit);
        damageUnit(world, u, POISON_DPS * p.stacks * p.potency, p.byFaction, `${by ? heroLabel(by) : '劇毒'}的劇毒`, by && by.hp > 0 ? by : undefined);
      }
    }

    // 召喚物到時間就消散
    if (u.expiresAt !== undefined && world.tick >= u.expiresAt) {
      u.hp = 0;
      continue;
    }

    const h = u.hero;
    if (!h) continue;
    if (h.skillCd > 0) h.skillCd--;
    if (h.path === 'summon') {
      if (h.summonCd > 0) h.summonCd--;
      const cap = 2 + (has(u, 'moreSummons') ? 1 : 0);
      if (h.summonCd === 0 && summonsOf(world, u).length < cap) {
        summon(world, u);
        h.summonCd = SUMMON_INTERVAL;
      }
    }
    if (!h.possessed && h.skillCd === 0 && aiWantsSkill(world, u)) useSkill(world, u);
    if (h.possessed && h.rally && world.tick % 10 === 0) recruitSquad(world, u);

    // 附身的英雄：站著不動時，敵人靠近會自動還手
    if (h.possessed && (u.action.type === 'idle' || (u.action.type === 'guard' && dist(u.x, u.y, u.action.x, u.action.y) < 0.6))) {
      const foe = enemiesNear(world, u.factionId, u.x, u.y, 2.5)[0];
      if (foe) u.action = { type: 'attackUnit', targetId: foe.id };
    }
  }
}

/** 英雄的戰鬥名片（UI 用） */
export function heroSummary(world: World, u: Unit): { combos: string[] } {
  const combos: string[] = [];
  const h = u.hero;
  if (!h) return { combos };
  const aura = auraBonus(world, u);
  if (aura.crit > 0) combos.push(`守護光環：暴擊率 +${Math.round(aura.crit * 100)}%、減傷 +${aura.armor}`);
  if (h.path === 'crit' || aura.crit > 0) {
    const venomAlly = world.units.some((o) => o.hp > 0 && o.factionId === u.factionId && o.hero?.path === 'venom');
    if (venomAlly || h.path === 'venom') combos.push('毒爆：暴擊打中中毒的敵人傷害 ×1.5');
  }
  if (h.path === 'summon' && aura.crit > 0) combos.push('召喚物也享有守護光環');
  return { combos };
}
