/**
 * 王國模式（1v1）平衡模擬：雙方都交給 AI，統計各種族勝率與對局長度。
 * 用法：npm run duel -- [場數] [起始種子] [easy|normal|hard]
 */
import { TICKS_PER_SECOND } from '../src/sim/constants';
import { createKingdomWorld } from '../src/sim/kingdom';
import { autoChoosePolicy } from '../src/sim/policies';
import { RACES, RACE_ORDER } from '../src/sim/races';
import type { Difficulty, RaceId } from '../src/sim/types';
import { step } from '../src/sim/world';

const games = Number(process.argv[2] ?? 60);
const startSeed = Number(process.argv[3] ?? 1);
const difficulty = (process.argv[4] ?? 'normal') as Difficulty;

interface Result { player: RaceId; enemy: RaceId; winner: RaceId | null; ticks: number; timeout: boolean }
const results: Result[] = [];
const t0 = Date.now();
for (let i = 0; i < games; i++) {
  const seed = startSeed + i;
  // 輪流排出所有對戰組合
  const player = RACE_ORDER[i % RACE_ORDER.length];
  const others = RACE_ORDER.filter((r) => r !== player);
  const enemy = others[Math.floor(i / RACE_ORDER.length) % others.length];
  const world = createKingdomWorld({ player, enemy, difficulty, seed, autoPlay: true });
  while (!world.over) {
    autoChoosePolicy(world);
    step(world);
  }
  results.push({
    player,
    enemy,
    winner: world.winner === null ? null : world.factions[world.winner].race,
    ticks: world.tick,
    timeout: world.endReason.startsWith('時間到'),
  });
  if ((i + 1) % 10 === 0) process.stdout.write(`  已完成 ${i + 1}/${games} 場\r`);
}
const pct = (n: number, d: number) => `${d ? ((n / d) * 100).toFixed(1) : '-'}%`.padStart(6);
console.log(`\n共 ${games} 場 1v1（難度 ${difficulty}，敵方套用難度），耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒\n`);
console.log('種族    出場  勝率   當玩家勝率  當敵方勝率');
for (const race of RACE_ORDER) {
  const asP = results.filter((r) => r.player === race);
  const asE = results.filter((r) => r.enemy === race);
  const all = [...asP, ...asE];
  const wins = all.filter((r) => r.winner === race).length;
  console.log(
    `${RACES[race].name.padEnd(4, '　')}  ${String(all.length).padStart(4)}  ${pct(wins, all.length)}  ${pct(asP.filter((r) => r.winner === race).length, asP.length)}     ${pct(asE.filter((r) => r.winner === race).length, asE.length)}`,
  );
}
const len = results.reduce((s, r) => s + r.ticks, 0) / results.length / TICKS_PER_SECOND;
const playerWins = results.filter((r) => r.winner === r.player).length;
console.log(
  `\n玩家方勝率 ${pct(playerWins, games).trim()}，時間到判定 ${pct(results.filter((r) => r.timeout).length, games).trim()}，` +
    `平均長度 ${Math.floor(len / 60)} 分 ${Math.round(len % 60)} 秒`,
);
