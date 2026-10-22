import { clamp } from '../math';
import type { Treaty, World } from '../types';

export const TREATY_NAMES: Record<Treaty, string> = { war: '交戰', peace: '和平', alliance: '同盟' };
export const TREATY_ICONS: Record<Treaty, string> = { war: '⚔', peace: '🕊', alliance: '🤝' };

export function getTreaty(world: World, a: number, b: number): Treaty {
  if (a === b) return 'alliance';
  return world.treaties[a]?.[b] ?? 'war';
}

/** 設定雙方的外交狀態；truceUntil > 0 表示到期後自動恢復交戰 */
export function setTreaty(world: World, a: number, b: number, t: Treaty, truceUntil = 0): void {
  if (a === b || !world.treaties[a] || !world.treaties[b]) return;
  world.treaties[a][b] = t;
  world.treaties[b][a] = t;
  world.truceUntil[a][b] = truceUntil;
  world.truceUntil[b][a] = truceUntil;
}

/** 調整 a 對 b 的觀感 */
export function adjustRelation(world: World, a: number, b: number, delta: number): void {
  const f = world.factions[a];
  if (!f || a === b || f.relations[b] === undefined) return;
  f.relations[b] = clamp(f.relations[b] + delta, -100, 100);
}

export function initTreaties(world: World): void {
  const n = world.factions.length;
  world.treaties = Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b): Treaty => (a === b ? 'alliance' : 'war')),
  );
  world.truceUntil = Array.from({ length: n }, () => Array<number>(n).fill(0));
}
