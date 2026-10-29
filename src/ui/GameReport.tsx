import { DIFFICULTIES, kingdomOutcome } from '../sim/kingdom';
import { POLICIES } from '../sim/policies';
import { analyzeGame } from '../sim/report';
import { trialById } from '../sim/trials';
import type { World } from '../sim/types';

interface Props {
  world: World;
  onAgain: () => void;
  onRetryTrial: () => void;
  onOpenTrials: () => void;
  onKingdomAgain: () => void;
  onOpenKingdom: () => void;
}

/** 戰局結束時的戰報：試煉結果、每個陣營為什麼輸、下次可以怎麼做 */
export function GameReport({ world, onAgain, onRetryTrial, onOpenTrials, onKingdomAgain, onOpenKingdom }: Props) {
  const kingdom = world.kingdom;
  const outcome = kingdomOutcome(world);
  const trial = world.trial;
  const trialDef = trial ? trialById(trial.id) : undefined;
  const winner = world.winner !== null ? world.factions[world.winner] : null;
  // 玩家指揮過的陣營排在最前面
  const reports = analyzeGame(world).sort(
    (a, b) => Number(b.faction.playerControlled) - Number(a.faction.playerControlled) || Number(b.won) - Number(a.won),
  );
  return (
    <div className="game-over">
      <div className="game-over-box">
        {trial && trialDef && (
          <div className={`trial-result ${trial.status}`}>
            <div className="trial-result-title">
              {trialDef.icon} {trialDef.name}：{trial.status === 'won' ? '試煉成功！' : '試煉失敗'}
            </div>
            <div>{trial.reason}</div>
            {trial.status !== 'won' && <div className="tip">💡 提示：{trialDef.hint}</div>}
          </div>
        )}
        {kingdom && (
          <div className={`trial-result ${outcome}`}>
            <div className="trial-result-title">
              {outcome === 'won' ? '👑 勝利！' : '💀 戰敗'}（{DIFFICULTIES[kingdom.difficulty].name}）
            </div>
            <div>{world.endReason}</div>
            {kingdom.history.length > 0 && (
              <div className="policy-history">
                {[kingdom.player, kingdom.enemy].map((id) => (
                  <div key={id}>
                    <b style={{ color: world.factions[id].color }}>{world.factions[id].name}</b> 的國策：
                    {kingdom.history
                      .filter((h) => h.factionId === id)
                      .map((h) => `${POLICIES[h.policy].icon}${POLICIES[h.policy].name}`)
                      .join('、') || '（沒有）'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!trial && !kingdom && (
          <div className="game-over-title" style={{ color: winner?.color }}>
            {world.endReason}
          </div>
        )}
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
        <div className="report-actions">
          {kingdom ? (
            <>
              <button className="primary" onClick={onKingdomAgain}>
                {outcome === 'won' ? '再戰一場' : '再挑戰一次'}
              </button>
              <button onClick={onOpenKingdom}>換王國／難度</button>
              <button onClick={onAgain}>自由模式</button>
            </>
          ) : trial ? (
            <>
              <button className="primary" onClick={onRetryTrial}>
                {trial.status === 'won' ? '再挑戰一次' : '再試一次'}
              </button>
              <button onClick={onOpenTrials}>試煉列表</button>
              <button onClick={onAgain}>自由模式</button>
            </>
          ) : (
            <button className="primary" onClick={onAgain}>
              再來一局
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
