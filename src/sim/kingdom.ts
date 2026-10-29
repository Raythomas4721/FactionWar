import { FIRST_POLICY_AT } from './policies';
import { RACE_ORDER } from './races';
import { Rng } from './rng';
import type { WorldRules } from './rules';
import type { Difficulty, ModKey, RaceId, World } from './types';
import { createWorld } from './world';

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
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: {
    name: '簡單',
    desc: '敵國採集 −20%、研究 −15%，比較晚出兵，也不會推行國策',
    enemyMods: { gather: 0.8, research: 0.85 },
    aggression: 0.75,
    counterPlay: false,
    enemyPolicies: false,
  },
  normal: {
    name: '普通',
    desc: '雙方條件相同，敵國也會推行國策',
    enemyMods: {},
    aggression: 1,
    counterPlay: false,
    enemyPolicies: true,
  },
  hard: {
    name: '困難',
    desc: '敵國採集 +25%、研究 +15%，更早出兵，還會針對你的兵種調整訓練',
    enemyMods: { gather: 1.25, research: 1.15 },
    aggression: 1.3,
    counterPlay: true,
    enemyPolicies: true,
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
};

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
  enemy.aggression = diff.aggression;
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
  return world;
}

/** 王國模式的結果（還沒結束是 null） */
export function kingdomOutcome(world: World): 'won' | 'lost' | null {
  const k = world.kingdom;
  if (!k || !world.over) return null;
  return world.winner === k.player ? 'won' : 'lost';
}
