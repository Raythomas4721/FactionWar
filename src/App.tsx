import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasRenderer, TILE_PX, pickAt, type Selection } from './render/canvasRenderer';
import { TICKS_PER_SECOND } from './sim/constants';
import type { World } from './sim/types';
import { createWorld, step } from './sim/world';
import { ControlBar } from './ui/ControlBar';
import { EventLog } from './ui/EventLog';
import { FactionPanel } from './ui/FactionPanel';
import { Inspector } from './ui/Inspector';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const MAX_STEPS_PER_FRAME = 400;
const UI_REFRESH_MS = 200;

export function App() {
  const worldRef = useRef<World>(createWorld(randomSeed()));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [, setUiTick] = useState(0);

  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const selectionRef = useRef(selection);
  speedRef.current = speed;
  pausedRef.current = paused;
  selectionRef.current = selection;

  useEffect(() => {
    const renderer = new CanvasRenderer(canvasRef.current!);
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let acc = 0;
    const frame = (now: number) => {
      const dt = Math.min(now - last, 250);
      last = now;
      const world = worldRef.current;
      if (!pausedRef.current && !world.over) acc += (dt / 1000) * TICKS_PER_SECOND * speedRef.current;
      let n = 0;
      while (acc >= 1 && n < MAX_STEPS_PER_FRAME) {
        step(world);
        acc--;
        n++;
      }
      if (n >= MAX_STEPS_PER_FRAME) acc = 0;
      renderer.draw(world, selectionRef.current);
      if (now - lastUi > UI_REFRESH_MS) {
        lastUi = now;
        setUiTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __world: () => World }).__world = () => worldRef.current;
  }, []);

  const newGame = useCallback((seed: number) => {
    worldRef.current = createWorld(seed);
    setSelection(null);
    setPaused(false);
  }, []);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const tx = ((e.clientX - rect.left) / rect.width) * world.width;
    const ty = ((e.clientY - rect.top) / rect.height) * world.height;
    setSelection(pickAt(world, tx, ty));
  };

  const world = worldRef.current;
  const winner = world.winner !== null ? world.factions[world.winner] : null;

  return (
    <div className="app">
      <ControlBar
        world={world}
        paused={paused}
        speed={speed}
        onTogglePause={() => setPaused((p) => !p)}
        onSpeed={setSpeed}
        onNewGame={() => newGame(randomSeed())}
        onRestart={() => newGame(world.seed)}
        onSeed={newGame}
      />
      <div className="main">
        <div className="board">
          <div className="canvas-wrap" style={{ aspectRatio: `${world.width * TILE_PX} / ${world.height * TILE_PX}` }}>
            <canvas ref={canvasRef} onClick={onCanvasClick} />
            {world.over && (
              <div className="game-over">
                <div className="game-over-title" style={{ color: winner?.color }}>{world.endReason}</div>
                <button onClick={() => newGame(randomSeed())}>再來一局</button>
              </div>
            )}
          </div>
          <Legend />
        </div>
        <div className="side">
          <Inspector world={world} selection={selection} />
          <EventLog world={world} />
        </div>
      </div>
      <FactionPanel world={world} />
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="lg-circle big" />戰士</span>
      <span><i className="lg-circle" />工人</span>
      <span><i className="lg-square" />鐵匠</span>
      <span><i className="lg-tile" style={{ background: '#3f7a3a' }} />森林</span>
      <span><i className="lg-tile" style={{ background: '#8a8f96' }} />石頭</span>
      <span><i className="lg-tile" style={{ background: '#e0904a' }} />鐵礦</span>
      <span><i className="lg-tile" style={{ background: '#d9465a' }} />漿果</span>
      <span className="muted">點擊小人或建築查看詳情 · 半透明＝撤退中</span>
    </div>
  );
}
