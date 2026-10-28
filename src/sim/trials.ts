import type { PowerId } from './powers';
import type { WorldRules } from './rules';
import type { RaceId, World } from './types';
import { createWorld } from './world';

/**
 * 造物主的試煉：固定種子的關卡，限制可用神力，有明確的成功與失敗條件。
 * 失敗後可以用同樣的局面再試一次。
 */
export interface TrialDef {
  id: string;
  name: string;
  icon: string;
  /** 難度 1～3 */
  difficulty: number;
  goal: string;
  desc: string;
  hint: string;
  seed: number;
  races: RaceId[];
  rules: Partial<WorldRules>;
  powers: PowerId[];
  /** 自動交給玩家指揮的種族 */
  command?: RaceId;
  /** 每個 tick 檢查：回傳成功／失敗的理由，或 null 代表還在進行 */
  check: (world: World) => { won: boolean; reason: string } | null;
  /** 目前進度（顯示在橫幅上） */
  progress: (world: World) => string;
}

const factionOf = (world: World, race: RaceId) => world.factions.find((f) => f.race === race && !f.neutral);
const minutes = (world: World) => world.tick / 600;
const winnerRace = (world: World) => (world.winner !== null ? world.factions[world.winner].race : null);

const TRIAL_LIST: TrialDef[] = [
  {
    id: 'underdog',
    name: '弱者的逆襲',
    icon: '🛡',
    difficulty: 3,
    goal: '讓人類王國統一大陸',
    desc: '人類被獸人、死靈與蟲族包圍。你指揮人類，只能用溫和的神力幫助他們。',
    hint: '早點蓋書院與兵營、練長矛兵；附身守護流英雄帶隊；用恩賜撐過寒冬。',
    seed: 4242,
    races: ['human', 'orc', 'undead', 'insect'],
    rules: {},
    powers: ['bless', 'gift', 'forest', 'ore'],
    command: 'human',
    check: (w) => {
      const h = factionOf(w, 'human');
      if (!h?.alive) return { won: false, reason: '人類王國覆滅了' };
      if (w.over) return winnerRace(w) === 'human' ? { won: true, reason: '人類王國統一了大陸！' } : { won: false, reason: w.endReason };
      return null;
    },
    progress: (w) => `存活對手 ${w.factions.filter((f) => f.alive && !f.neutral && f.race !== 'human').length} 個`,
  },
  {
    id: 'peacemaker',
    name: '和平使者',
    icon: '🕊',
    difficulty: 3,
    goal: '守護 20 分鐘，不讓任何陣營覆滅',
    desc: '四族互相仇視，休戰只有 3 分鐘。你是唯一希望天下太平的神，只能用和平的手段。',
    hint: '神諭和平要用在快被攻破的那一族身上；恩賜幫弱者蓋箭塔，祝福救前線。',
    seed: 777,
    races: ['orc', 'elf', 'dwarf', 'human'],
    rules: { peaceMinutes: 3, maxMinutes: 20 },
    powers: ['truce', 'gift', 'bless'],
    check: (w) => {
      const fallen = w.factions.find((f) => !f.alive && !f.neutral);
      if (fallen) return { won: false, reason: `${fallen.name} 覆滅了，和平破碎` };
      if (minutes(w) >= 20 || w.over) return { won: true, reason: '20 分鐘過去，四族都還活著。和平守住了！' };
      return null;
    },
    progress: (w) => {
      const weakest = w.factions
        .filter((f) => f.alive && !f.neutral)
        .map((f) => ({ f, hq: w.buildings.find((b) => b.id === f.hqId) }))
        .filter((x) => x.hq)
        .reduce((a, b) => (b.hq!.hp / b.hq!.maxHp < a.hq!.hp / a.hq!.maxHp ? b : a));
      const pct = Math.round((weakest.hq!.hp / weakest.hq!.maxHp) * 100);
      return `剩餘 ${Math.max(0, 20 - minutes(w)).toFixed(1)} 分鐘；最危險：${weakest.f.name}（營帳 ${pct}%）`;
    },
  },
  {
    id: 'plaguegod',
    name: '瘟疫之神',
    icon: '☣',
    difficulty: 1,
    goal: '15 分鐘內消滅蟲巢',
    desc: '蟲巢在大陸上瘋狂繁衍。你只能降下天災。',
    hint: '蟲族擠在一起最容易染疫：先在巢穴附近降瘟疫，等牠們擠回營帳養病時再降天雷。',
    seed: 1313,
    races: ['insect', 'human', 'dwarf', 'elf'],
    rules: { maxMinutes: 15 },
    powers: ['plague', 'lightning'],
    check: (w) => {
      const bugs = factionOf(w, 'insect');
      if (!bugs?.alive) return { won: true, reason: `蟲巢在 ${minutes(w).toFixed(1)} 分時被消滅了！` };
      if (w.over || minutes(w) >= 15) return { won: false, reason: '15 分鐘內沒能消滅蟲巢' };
      return null;
    },
    progress: (w) => {
      const bugs = factionOf(w, 'insect');
      const n = bugs ? w.units.filter((u) => u.factionId === bugs.id && u.hp > 0).length : 0;
      return `蟲巢剩 ${n} 隻，剩餘 ${Math.max(0, 15 - minutes(w)).toFixed(1)} 分鐘`;
    },
  },
  {
    id: 'heroroad',
    name: '英雄之路',
    icon: '⭐',
    difficulty: 2,
    goal: '附身一名英雄，讓牠升到 Lv5',
    desc: '傳奇從來不是天生的。找到一名剛晉升的英雄，親手帶他走上巔峰。',
    hint: '在英雄榜點英雄 → 附身。挑落單的敵人打、低血就撤退；殺英雄和怪物的經驗更多。',
    seed: 2024,
    races: ['orc', 'elf', 'dwarf', 'human'],
    rules: { maxMinutes: 25 },
    powers: ['bless'],
    check: (w) => {
      const champion = w.units.find((u) => u.hp > 0 && u.hero?.everPossessed && u.hero.level >= 5);
      if (champion) return { won: true, reason: `${champion.name}「${champion.hero!.title}」成為 Lv5 的傳奇英雄！` };
      if (w.over) return { won: false, reason: '時間內沒有附身英雄達到 Lv5' };
      return null;
    },
    progress: (w) => {
      const mine = w.units.filter((u) => u.hp > 0 && u.hero?.everPossessed);
      if (!mine.length) return '還沒有附身過英雄（英雄榜 → 點英雄 → 附身）';
      const best = mine.reduce((a, b) => (b.hero!.level > a.hero!.level ? b : a));
      return `${best.name} Lv${best.hero!.level}／5`;
    },
  },
  {
    id: 'dragonslayer',
    name: '屠龍者',
    icon: '🐉',
    difficulty: 2,
    goal: '讓矮人氏族在 20 分鐘內攻陷巨龍之巢',
    desc: '大陸中央沉睡著遠古巨龍。矮人想要龍的寶藏，你要幫他們撐到那一刻。',
    hint: '先清掉身邊的小巢穴拿寶藏；援軍與恩賜要用在出擊前；別讓其他陣營搶走最後一擊。',
    seed: 9001,
    races: ['dwarf', 'orc', 'elf', 'undead'],
    rules: { neutralLairs: true, maxMinutes: 20 },
    powers: ['gift', 'reinforce', 'bless'],
    command: 'dwarf',
    check: (w) => {
      const dwarves = factionOf(w, 'dwarf');
      const dragon = w.lairs.find((l) => l.monster === 'dragon');
      if (dragon && dwarves && dragon.claimedBy === dwarves.id) return { won: true, reason: '矮人氏族屠龍成功，奪得龍之寶藏！' };
      if (dragon && dragon.claimedBy !== null) return { won: false, reason: '巨龍之巢被其他人搶先攻陷了' };
      if (!dwarves?.alive) return { won: false, reason: '矮人氏族覆滅了' };
      if (w.over || minutes(w) >= 20) return { won: false, reason: '20 分鐘內沒能屠龍' };
      return null;
    },
    progress: (w) => {
      const dragon = w.units.find((u) => u.monster === 'dragon' && u.hp > 0);
      return dragon ? `巨龍生命 ${Math.ceil(dragon.hp)}/${dragon.maxHp}，剩餘 ${Math.max(0, 20 - minutes(w)).toFixed(1)} 分鐘` : '巨龍已倒下';
    },
  },
  {
    id: 'necro',
    name: '死者的黎明',
    icon: '💀',
    difficulty: 2,
    goal: '讓死靈軍團統一大陸（不准用天雷）',
    desc: '這一次，你站在亡者那一邊。',
    hint: '戰場上死的人越多，死靈就越強：挑撥離間讓活人互相殘殺，瘟疫削弱他們，死靈坐收漁利。',
    seed: 666,
    races: ['undead', 'human', 'elf', 'dwarf'],
    rules: {},
    powers: ['plague', 'discord', 'reinforce', 'gift'],
    command: 'undead',
    check: (w) => {
      const u = factionOf(w, 'undead');
      if (!u?.alive) return { won: false, reason: '死靈軍團被消滅了' };
      if (w.over) return winnerRace(w) === 'undead' ? { won: true, reason: '死者的黎明降臨大陸！' } : { won: false, reason: w.endReason };
      return null;
    },
    progress: (w) => `存活的活人陣營 ${w.factions.filter((f) => f.alive && !f.neutral && f.race !== 'undead').length} 個`,
  },
];

/** 由易到難排列 */
export const TRIALS: TrialDef[] = [...TRIAL_LIST].sort((a, b) => a.difficulty - b.difficulty);

export function trialById(id: string): TrialDef | undefined {
  return TRIALS.find((t) => t.id === id);
}

/** 建立試煉的世界：固定種子、指定種族與規則，限制神力 */
export function createTrialWorld(def: TrialDef, baseRules: Partial<WorldRules> = {}): World {
  const world = createWorld(def.seed, {
    rules: { ...baseRules, ...def.rules, raceSelection: def.races, infiniteMana: false },
  });
  world.trial = { id: def.id, status: 'running', reason: '', powers: def.powers };
  if (def.command) {
    const f = world.factions.find((x) => x.race === def.command);
    if (f) f.playerControlled = true;
  }
  return world;
}

/** 每個 tick 檢查試煉是否結束；結束時也讓戰局結束 */
export function evaluateTrial(world: World): void {
  const t = world.trial;
  if (!t || t.status !== 'running') return;
  const def = trialById(t.id);
  if (!def) return;
  const result = def.check(world);
  if (!result) return;
  t.status = result.won ? 'won' : 'lost';
  t.reason = result.reason;
  world.over = true;
  world.endReason = `${result.won ? '試煉成功' : '試煉失敗'}：${result.reason}`;
}
