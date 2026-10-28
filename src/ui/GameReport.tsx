import { analyzeGame } from '../sim/report';
import type { World } from '../sim/types';

/** 戰局結束時的戰報：每個陣營為什麼輸、下次可以怎麼做 */
export function GameReport({ world, onAgain }: { world: World; onAgain: () => void }) {
  const winner = world.winner !== null ? world.factions[world.winner] : null;
  // 玩家指揮過的陣營排在最前面
  const reports = analyzeGame(world).sort(
    (a, b) => Number(b.faction.playerControlled) - Number(a.faction.playerControlled) || Number(b.won) - Number(a.won),
  );
  return (
    <div className="game-over">
      <div className="game-over-box">
        <div className="game-over-title" style={{ color: winner?.color }}>
          {world.endReason}
        </div>
        <div className="report-list">
          {reports.map((r) => (
            <div key={r.faction.id} className={`report ${r.won ? 'won' : ''}`} style={{ borderLeftColor: r.faction.color }}>
              <div className="report-head">
                <b style={{ color: r.faction.color }}>{r.faction.name}</b>
                {r.faction.playerControlled && <span className="badge">你指揮的</span>}
                <span className="muted">{r.headline}</span>
              </div>
              {r.findings.map((fd) => (
                <div key={fd.text} className="finding">
                  <div>❌ {fd.text}</div>
                  <div className="tip">💡 {fd.tip}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button className="primary" onClick={onAgain}>
          再來一局
        </button>
      </div>
    </div>
  );
}
