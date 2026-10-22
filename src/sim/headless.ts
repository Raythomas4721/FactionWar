import type { RaceId } from './types';
import { createWorld, score, step, type WorldOptions } from './world';

export interface FactionResult {
  race: RaceId;
  alive: boolean;
  eliminatedAt: number | null;
  tech: number;
  kills: number;
  crafted: number;
  built: number;
  infections: number;
  diseaseDeaths: number;
  starved: number;
  recruited: number;
  treaties: number;
  score: number;
}

export interface GameResult {
  seed: number;
  ticks: number;
  winner: RaceId | null;
  endReason: string;
  allianceWin: boolean;
  factions: FactionResult[];
}

/** 不開畫面跑完一整場，給平衡模擬器與測試使用 */
export function runGame(seed: number, opts: WorldOptions = {}): GameResult {
  const world = createWorld(seed, opts);
  while (!world.over) step(world);
  return {
    seed,
    ticks: world.tick,
    winner: world.winner === null ? null : world.factions[world.winner].race,
    endReason: world.endReason,
    allianceWin: world.endReason.includes('結盟共治'),
    factions: world.factions.map((f) => ({
      race: f.race,
      alive: f.alive,
      eliminatedAt: f.eliminatedAt,
      tech: f.tech,
      kills: f.stats.kills,
      crafted: f.stats.crafted,
      built: f.stats.built,
      infections: f.stats.infections,
      diseaseDeaths: f.stats.diseaseDeaths,
      starved: f.stats.starved,
      recruited: f.stats.recruited,
      treaties: f.stats.treaties,
      score: score(world, f),
    })),
  };
}
