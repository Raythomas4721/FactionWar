import { useState } from 'react';
import { TICKS_PER_SECOND } from '../sim/constants';
import type { World } from '../sim/types';

const SPEEDS = [1, 2, 5, 10, 20];

interface Props {
  world: World;
  paused: boolean;
  speed: number;
  onTogglePause: () => void;
  onSpeed: (s: number) => void;
  onNewGame: () => void;
  onRestart: () => void;
  onSeed: (seed: number) => void;
  onOpenRules: () => void;
  onOpenTrials: () => void;
  onOpenKingdom: () => void;
  onHelp: () => void;
}

export function formatTime(tick: number): string {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ControlBar({
  world, paused, speed, onTogglePause, onSpeed, onNewGame, onRestart, onSeed, onOpenRules, onOpenTrials, onOpenKingdom, onHelp,
}: Props) {
  const [seedInput, setSeedInput] = useState('');
  return (
    <header className="control-bar">
      <h1>四族戰紀</h1>
      <button className="primary" onClick={onTogglePause} disabled={world.over}>
        {paused ? '▶ 繼續' : '⏸ 暫停'}
      </button>
      <div className="speed-group">
        {SPEEDS.map((s) => (
          <button key={s} className={s === speed ? 'active' : ''} onClick={() => onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <span className="clock">⏱ {formatTime(world.tick)} / {formatTime(world.maxTicks)}</span>
      <button className="kingdom-btn" onClick={onOpenKingdom}>👑 王國模式</button>
      <button onClick={onOpenRules}>📜 世界法則</button>
      <button onClick={onOpenTrials}>🏆 試煉</button>
      <button onClick={onHelp} title="玩法說明" aria-label="玩法說明">❓</button>
      <span className="spacer" />
      <span className="muted">種子 {world.seed}</span>
      <button onClick={onRestart} title="用同一個種子重播">↺ 重播</button>
      <form
        className="seed-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(seedInput);
          if (Number.isFinite(n) && seedInput !== '') onSeed(Math.floor(n));
        }}
      >
        <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} placeholder="指定種子" inputMode="numeric" />
      </form>
      <button onClick={onNewGame}>🎲 新局</button>
    </header>
  );
}
