import { FIRST_POLICY_AT } from './policies';
import { RACE_ORDER } from './races';
import { Rng } from './rng';
import type { WorldRules } from './rules';
import type { Difficulty, ModKey, RaceId, World } from './types';
import { createWorld } from './world';
import { createFog } from './fog';

/**
 * 王國模式：玩家選一個王國，在 1v1 對峙地圖上對抗一個 AI 陣營。
 * 玩家負責戰略（進攻、防守、討伐巢穴）、國策與附身英雄；採集、補兵、打造由 AI 打理。
 */
export interface KingdomSetup {
  player: RaceId;
  /** 對手種族；random = 從其他種族隨機挑一個 */
  enemy: RaceId | 'random';
  difficulty: Difficulty;
  seed: number;
  /** 戰爭迷霧（預設開啟） */
  fog?: boolean;
  /** 玩家陣營也交給 AI（平衡測試用） */
  autoPlay?: boolean;
}

export interface DifficultyDef {
  name: string;
  desc: string;
  /** 敵方的永久倍率 */
  enemyMods: Partial<Record<ModKey, number>>;
  aggression: number;
  counterPlay: boolean;
  /** 敵方會不會推行國策 */
  enemyPolicies: boolean;
  /** 敵方會不會發動戰術指令（衝鋒號、盾牆） */
  enemyAbilities: boolean;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: {
    name: '簡單',
    desc: '敵國採集 −20%、研究 −15%，比較晚出兵，也不會推行國策與戰術指令',
    enemyMods: { gather: 0.8, research: 0.85 },
    aggression: 0.75,
    counterPlay: false,
    enemyPolicies: false,
    enemyAbilities: false,
  },
  normal: {
    name: '普通',
    desc: '雙方條件相同，敵國也會推行國策、使用戰術指令',
    enemyMods: {},
    aggression: 1,
    counterPlay: false,
    enemyPolicies: true,
    enemyAbilities: true,
  },
  hard: {
    name: '困難',
    desc: '敵國採集 +25%、研究 +15%，更早出兵，還會針對你的兵種調整訓練',
    enemyMods: { gather: 1.25, research: 1.15 },
    aggression: 1.3,
    counterPlay: true,
    enemyPolicies: true,
    enemyAbilities: true,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];

/** 王國模式的規則：休戰短一點、沒有結盟共治 */
export const KINGDOM_RULES: Partial<WorldRules> = {
  peaceMinutes: 3,
  maxMinutes: 30,
  allianceVictory: false,
  neutralLairs: true,
  randomEvents: true,
  infiniteMana: false,
  raceSelection: [],
  // 1v1 的種族平衡（npm run duel 雙方 AI 各打數百場調出來的；四族混戰不受影響）：
  // 蟲海在只有一個對手時太強，人類的外交長處在 1v1 用不上
  racePower: { orc: 0.96, elf: 0.97, dwarf: 1.04, human: 1.1, undead: 1, insect: 0.88, beast: 1 },
};

/** 1v1 額外的種族修正（目前只靠上面的屬性倍率就夠了，保留給之後微調） */
export const KINGDOM_RACE_MODS: Partial<Record<RaceId, Partial<Record<ModKey, number>>>> = {};

export function resolveEnemy(setup: KingdomSetup): RaceId {
  if (setup.enemy !== 'random' && setup.enemy !== setup.player) return setup.enemy;
  const rng = new Rng(setup.seed ^ 0x5bd1e995);
  return rng.pick(RACE_ORDER.filter((r) => r !== setup.player));
}

export function createKingdomWorld(setup: KingdomSetup): World {
  const enemyRace = resolveEnemy(setup);
  const world = createWorld(setup.seed, { rules: KINGDOM_RULES, duel: true, races: [setup.player, enemyRace] });
  const player = world.factions[0];
  const enemy = world.factions[1];
  const diff = DIFFICULTIES[setup.difficulty];
  player.playerControlled = !setup.autoPlay;
  for (const f of [player, enemy]) {
    const mods = KINGDOM_RACE_MODS[f.race];
    if (mods) f.modifiers.push({ source: 'balance', name: '1v1 平衡', icon: '⚖', mods, until: Infinity, hidden: true });
  }
  enemy.aggression = diff.aggression;
  enemy.useAbilities = diff.enemyAbilities;
  // 平衡測試時玩家也交給 AI，條件要和敵方一樣
  player.useAbilities = !!setup.autoPlay && diff.enemyAbilities;
  enemy.counterPlay = diff.counterPlay;
  if (Object.keys(diff.enemyMods).length) {
    enemy.modifiers.push({ source: 'difficulty', name: `難度：${diff.name}`, icon: '🎚', mods: diff.enemyMods, until: Infinity });
  }
  world.kingdom = {
    player: player.id,
    enemy: enemy.id,
    difficulty: setup.difficulty,
    offer: null,
    nextPolicyAt: FIRST_POLICY_AT,
    aiNextPolicyAt: diff.enemyPolicies ? FIRST_POLICY_AT + 300 : Infinity,
    history: [],
  };
  if (!setup.autoPlay && setup.fog !== false) createFog(world, player.id);
  return world;
}

/** 王國模式的結果（還沒結束是 null） */
export function kingdomOutcome(world: World): 'won' | 'lost' | null {
  const k = world.kingdom;
  if (!k || !world.over) return null;
  return world.winner === k.player ? 'won' : 'lost';
}
