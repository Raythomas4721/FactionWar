/**
 * 平衡模擬器：不開畫面連跑 N 場，統計各種族勝率。
 * 每局從六族中選四族參戰，所以勝率以「出場的場次」計算（理想值 25%）。
 * 用法：npm run balance -- [場數] [起始種子] [classic]
 *   加上 classic 只用經典四族對戰。
 */
import { TICKS_PER_SECOND } from '../src/sim/constants';
import { runGame, type GameResult } from '../src/sim/headless';
import { CLASSIC_RACES, RACES, RACE_ORDER } from '../src/sim/races';

const games = Number(process.argv[2] ?? 100);
const startSeed = Number(process.argv[3] ?? 1);
const classic = process.argv[4] === 'classic';

const results: GameResult[] = [];
const t0 = Date.now();
for (let i = 0; i < games; i++) {
  results.push(runGame(startSeed + i, classic ? { rules: { raceSelection: CLASSIC_RACES } } : {}));
  if ((i + 1) % 10 === 0) process.stdout.write(`  已完成 ${i + 1}/${games} 場\r`);
}
const elapsed = (Date.now() - t0) / 1000;

const pctOf = (n: number, d: number) => `${d ? ((n / d) * 100).toFixed(1) : '-'}%`.padStart(6);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`\n共 ${games} 場（種子 ${startSeed}~${startSeed + games - 1}${classic ? '，經典四族' : '，六族隨機選四'}），耗時 ${elapsed.toFixed(1)} 秒\n`);
console.log('種族    出場  勝率    存活率  平均科技  平均擊殺  平均打造  平均染病  平均病死  平均招降  平均締約  平均發明');
const rates: number[] = [];
for (const race of RACE_ORDER) {
  const played = results.filter((r) => r.factions.some((f) => f.race === race));
  if (!played.length) continue;
  const wins = played.filter((r) => r.winner === race).length;
  rates.push(wins / played.length);
  const fr = played.map((r) => r.factions.find((f) => f.race === race)!);
  console.log(
    [
      RACES[race].name.padEnd(4, '　'),
      String(played.length).padStart(4),
      pctOf(wins, played.length),
      pctOf(fr.filter((f) => f.alive).length, played.length),
      avg(fr.map((f) => f.tech)).toFixed(2).padStart(8),
      avg(fr.map((f) => f.kills)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.crafted)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.infections)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.diseaseDeaths)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.recruited)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.treaties)).toFixed(1).padStart(8),
      avg(fr.map((f) => f.inventions)).toFixed(1).padStart(8),
    ].join('  '),
  );
}

const timeouts = results.filter((r) => r.endReason.startsWith('時間到')).length;
const allianceWins = results.filter((r) => r.allianceWin).length;
const len = avg(results.map((r) => r.ticks)) / TICKS_PER_SECOND;
console.log(
  `\n平均對局長度 ${Math.floor(len / 60)} 分 ${Math.round(len % 60)} 秒（遊戲內 1x 速度），` +
    `時間到判定 ${pctOf(timeouts, games).trim()}，結盟共治 ${pctOf(allianceWins, games).trim()}`,
);

const ok = rates.every((r) => r >= 0.15 && r <= 0.35);
console.log(ok ? '✅ 各種族出場勝率都在 15%~35% 之間' : '⚠ 勝率不均衡，需要調參');
