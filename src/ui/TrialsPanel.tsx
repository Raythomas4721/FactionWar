import { POWER_DEFS } from '../sim/powers';
import { RACES } from '../sim/races';
import { TRIALS, type TrialDef } from '../sim/trials';
import { formatTime } from './ControlBar';

const TRIALS_KEY = 'factionwar.trials';

/** 通過的試煉與最佳時間（tick），記在這台瀏覽器 */
export function loadTrialRecords(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TRIALS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveTrialRecord(id: string, ticks: number): void {
  try {
    const rec = loadTrialRecords();
    if (!rec[id] || ticks < rec[id]) rec[id] = ticks;
    localStorage.setItem(TRIALS_KEY, JSON.stringify(rec));
  } catch {
    // 無痕模式時不記錄
  }
}

interface Props {
  onStart: (def: TrialDef) => void;
  onClose: () => void;
}

export function TrialsPanel({ onStart, onClose }: Props) {
  const records = loadTrialRecords();
  const cleared = TRIALS.filter((t) => records[t.id]).length;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel trials" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>🏆 造物主的試煉</h2>
          <span className="muted">
            已通過 {cleared}/{TRIALS.length}
          </span>
          <button onClick={onClose}>✕</button>
        </div>
        <p className="muted">每個試煉的局面固定，失敗後可以用同樣的局面再試一次。</p>
        <div className="trial-list">
          {TRIALS.map((t) => (
            <div key={t.id} className={`trial ${records[t.id] ? 'cleared' : ''}`}>
              <div className="trial-head">
                <span className="trial-icon">{t.icon}</span>
                <b>{t.name}</b>
                <span className="stars" title={`難度 ${t.difficulty}`}>
                  {'★'.repeat(t.difficulty)}
                  {'☆'.repeat(3 - t.difficulty)}
                </span>
                {records[t.id] && <span className="badge">✓ 最佳 {formatTime(records[t.id])}</span>}
              </div>
              <div className="trial-goal">🎯 {t.goal}</div>
              <div className="muted">{t.desc}</div>
              <div className="trial-meta">
                <span>
                  參戰：
                  {t.races.map((r) => (
                    <span key={r} style={{ color: RACES[r].color }}>
                      {RACES[r].name}{' '}
                    </span>
                  ))}
                </span>
                <span>神力：{t.powers.map((p) => POWER_DEFS[p].icon + POWER_DEFS[p].name).join('、')}</span>
              </div>
              <button className="primary" onClick={() => onStart(t)}>
                開始試煉
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
