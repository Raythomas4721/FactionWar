import { useState } from 'react';
import { DIFFICULTIES, DIFFICULTY_ORDER, type KingdomSetup } from '../sim/kingdom';
import { RACES, RACE_ORDER } from '../sim/races';
import type { Difficulty, RaceId } from '../sim/types';

const SETUP_KEY = 'factionwar.kingdom.setup';
const RECORDS_KEY = 'factionwar.kingdom.records';

type SavedSetup = Omit<KingdomSetup, 'seed' | 'autoPlay'>;
/** 每個種族打贏過哪些難度 */
type Records = Partial<Record<RaceId, Difficulty[]>>;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 無痕模式時不記錄
  }
}

export function saveKingdomWin(race: RaceId, difficulty: Difficulty): void {
  const rec = load<Records>(RECORDS_KEY, {});
  const list = rec[race] ?? [];
  if (!list.includes(difficulty)) rec[race] = [...list, difficulty];
  save(RECORDS_KEY, rec);
}

export const RACE_ICONS: Record<RaceId, string> = {
  orc: '🪓', elf: '🏹', dwarf: '⛏', human: '🛡', undead: '💀', insect: '🐜', beast: '🐺',
};

interface Props {
  onStart: (setup: KingdomSetup) => void;
  onClose: () => void;
}

/** 王國模式的開局畫面：選自己的王國、對手與難度 */
export function KingdomSetupPanel({ onStart, onClose }: Props) {
  const [setup, setSetup] = useState<SavedSetup>(() =>
    load<SavedSetup>(SETUP_KEY, { player: 'human', enemy: 'random', difficulty: 'normal' }),
  );
  const records = load<Records>(RECORDS_KEY, {});
  const update = (patch: Partial<SavedSetup>) => {
    const next = { ...setup, ...patch };
    if (next.enemy === next.player) next.enemy = 'random';
    setSetup(next);
  };
  const start = () => {
    save(SETUP_KEY, setup);
    onStart({ ...setup, seed: Math.floor(Math.random() * 1_000_000) });
  };
  const mine = RACES[setup.player];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel kingdom-setup" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>👑 王國模式</h2>
          <span className="muted">選一個王國，在 1v1 地圖上擊敗對手</span>
          <button onClick={onClose} aria-label="關閉">✕</button>
        </div>

        <h3>你的王國</h3>
        <div className="race-grid">
          {RACE_ORDER.map((r) => (
            <button
              key={r}
              className={`race-pick ${setup.player === r ? 'active' : ''}`}
              style={{ borderColor: setup.player === r ? RACES[r].color : undefined }}
              onClick={() => update({ player: r })}
            >
              <span className="race-icon">{RACE_ICONS[r]}</span>
              <b style={{ color: RACES[r].color }}>{RACES[r].factionName}</b>
              <span className="race-wins">
                {DIFFICULTY_ORDER.map((d) => (
                  <i key={d} className={records[r]?.includes(d) ? 'won' : ''} title={`${DIFFICULTIES[d].name}：${records[r]?.includes(d) ? '已勝利' : '未勝利'}`} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <ul className="traits">
          {mine.traits.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <h3>對手</h3>
        <div className="chip-row">
          <button className={setup.enemy === 'random' ? 'active' : ''} onClick={() => update({ enemy: 'random' })}>
            🎲 隨機
          </button>
          {RACE_ORDER.filter((r) => r !== setup.player).map((r) => (
            <button
              key={r}
              className={setup.enemy === r ? 'active' : ''}
              style={{ color: RACES[r].color }}
              onClick={() => update({ enemy: r })}
            >
              {RACE_ICONS[r]} {RACES[r].name}
            </button>
          ))}
        </div>

        <h3>難度</h3>
        <div className="difficulty-list">
          {DIFFICULTY_ORDER.map((d) => (
            <label key={d} className={`difficulty ${setup.difficulty === d ? 'active' : ''}`}>
              <input type="radio" name="difficulty" checked={setup.difficulty === d} onChange={() => update({ difficulty: d })} />
              <b>{DIFFICULTIES[d].name}</b>
              <span className="muted">{DIFFICULTIES[d].desc}</span>
            </label>
          ))}
        </div>

        <label className="rule-check">
          <input type="checkbox" checked={setup.fog !== false} onChange={(e) => update({ fog: e.target.checked })} />
          🌫 戰爭迷霧：只看得到自己視野內的東西，要派斥候或佔領瞭望塔偵察
        </label>

        <div className="muted kingdom-howto">
          你是國王：決定進攻、防守或討伐巢穴，派兵駐守據點（礦場、瞭望塔、戰神祠），每 4 分鐘選一張國策卡，關鍵時刻附身英雄親自上陣。
          採集、補兵與打造由大臣（AI）打理。攻陷對方營帳就勝利；打贏後還能擴張版圖，進入隔海相望的三國鼎立。
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={start}>
            ⚔ 開戰
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
