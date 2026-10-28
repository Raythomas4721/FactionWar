import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasRenderer, TILE_PX, pickAt, type PowerCursor, type Selection } from './render/canvasRenderer';
import { TICKS_PER_SECOND } from './sim/constants';
import { POWER_DEFS, POWER_ORDER, castPower, nearestFaction, type PowerId } from './sim/powers';
import { maxTicksOf, mergeRules, type WorldRules } from './sim/rules';
import type { World } from './sim/types';
import { createWorld, step } from './sim/world';
import { ControlBar } from './ui/ControlBar';
import { EventLog } from './ui/EventLog';
import { FactionPanel } from './ui/FactionPanel';
import { GodBar } from './ui/GodBar';
import { Inspector } from './ui/Inspector';
import { RulesPanel } from './ui/RulesPanel';
import { HeroPanel } from './ui/HeroPanel';
import { GameReport } from './ui/GameReport';
import { commandHero, possessedHero, release, useSkill } from './sim/systems/heroSystem';
import { PATHS } from './sim/heroes';
import { createTrialWorld, trialById, type TrialDef } from './sim/trials';
import { TrialsPanel, saveTrialRecord } from './ui/TrialsPanel';
import { EventsBar, TrialBanner } from './ui/WorldBanners';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const MAX_STEPS_PER_FRAME = 400;
const UI_REFRESH_MS = 200;
const RULES_KEY = 'factionwar.rules';

function loadRules(): WorldRules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return mergeRules(raw ? JSON.parse(raw) : {});
  } catch {
    return mergeRules();
  }
}

function saveRules(rules: WorldRules) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // 無痕模式或被封鎖時就不記憶
  }
}

export function App() {
  const [rules, setRules] = useState<WorldRules>(loadRules);
  const worldRef = useRef<World>(createWorld(randomSeed(), { rules }));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [power, setPower] = useState<PowerId | null>(null);
  const [castMsg, setCastMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showTrials, setShowTrials] = useState(false);
  const savedTrialRef = useRef<World | null>(null);
  const [, setUiTick] = useState(0);

  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const selectionRef = useRef(selection);
  const powerRef = useRef(power);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  speedRef.current = speed;
  pausedRef.current = paused || showRules || showTrials;
  selectionRef.current = selection;
  powerRef.current = power;

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
      renderer.draw(world, selectionRef.current, cursorFor(world, powerRef.current, mouseRef.current));
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

  // 快捷鍵：1–9 選神力、Esc 取消、空白鍵暫停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < POWER_ORDER.length) setPower((p) => (p === POWER_ORDER[idx] ? null : POWER_ORDER[idx]));
      else if (e.key === 'Escape') {
        setPower(null);
        release(worldRef.current);
      } else if (e.key === 'q' || e.key === 'Q') {
        const hero = possessedHero(worldRef.current);
        if (hero) useSkill(worldRef.current, hero);
      }
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newGame = useCallback(
    (seed: number) => {
      worldRef.current = createWorld(seed, { rules });
      setSelection(null);
      setPaused(false);
      setCastMsg(null);
    },
    [rules],
  );

  const startTrial = useCallback((def: TrialDef) => {
    worldRef.current = createTrialWorld(def);
    setSelection(null);
    setPaused(false);
    setPower(null);
    setCastMsg({ ok: true, text: `試煉開始：${def.goal}` });
    setShowTrials(false);
  }, []);

  const changeRules = (next: WorldRules) => {
    setRules(next);
    saveRules(next);
    // 即時規則直接套用；地圖與開局科技要等新局
    const world = worldRef.current;
    world.rules = { ...next, resourceRichness: world.rules.resourceRichness, startTech: world.rules.startTech };
    world.maxTicks = maxTicksOf(world.rules);
  };

  const toTile = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * world.width,
      y: ((e.clientY - rect.top) / rect.height) * world.height,
    };
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    const { x, y } = toTile(e);
    const hero = possessedHero(world);
    if (!power && hero) {
      setCastMsg({ ok: true, text: `👁 ${hero.name}：${commandHero(world, hero, x, y)}` });
      return;
    }
    if (power) {
      const r = castPower(world, power, x, y);
      setCastMsg({ ok: r.ok, text: r.message });
      if (!world.rules.infiniteMana && world.mana < POWER_DEFS[power].cost) setPower(null);
      return;
    }
    // 至少容許約 14 像素的誤差，手機上手指才點得到小人
    const tilePx = e.currentTarget.getBoundingClientRect().width / world.width;
    setSelection(pickAt(world, x, y, Math.max(0.9, 14 / tilePx)));
  };

  const world = worldRef.current;
  const possessed = possessedHero(world);
  // 通過試煉時記錄最佳時間（每個世界只記一次）
  if (world.trial?.status === 'won' && savedTrialRef.current !== world) {
    savedTrialRef.current = world;
    saveTrialRecord(world.trial.id, world.tick);
  }

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
        onOpenRules={() => setShowRules(true)}
        onOpenTrials={() => setShowTrials(true)}
      />
      <div className="main">
        <div className="board">
          <TrialBanner world={world} onQuit={() => newGame(randomSeed())} />
          <GodBar world={world} selected={power} onSelect={setPower} message={castMsg} />
          <EventsBar world={world} />
          {possessed?.hero && (
            <div className="possess-bar">
              <span>
                👁 附身中：<b>{possessed.name}「{possessed.hero.title}」</b>
                <span className="muted"> 點地圖移動、點敵人攻擊</span>
              </span>
              <span className="spacer" />
              <button
                className="primary"
                disabled={possessed.hero.skillCd > 0}
                onClick={() => useSkill(world, possessed)}
              >
                ⚡ {PATHS[possessed.hero.path].skill.name}
                {possessed.hero.skillCd > 0 ? ` ${Math.ceil(possessed.hero.skillCd / TICKS_PER_SECOND)}s` : ' (Q)'}
              </button>
              <button onClick={() => release(world)}>解除 (Esc)</button>
            </div>
          )}
          {/* 手機上地圖放大，左右滑動查看 */}
          <div className="canvas-scroll">
          <div className="canvas-wrap" style={{ aspectRatio: `${world.width * TILE_PX} / ${world.height * TILE_PX}` }}>
            <canvas
              ref={canvasRef}
              className={power ? 'casting' : ''}
              onClick={onCanvasClick}
              onMouseMove={(e) => (mouseRef.current = toTile(e))}
              onMouseLeave={() => (mouseRef.current = null)}
              onContextMenu={(e) => {
                if (!power) return;
                e.preventDefault();
                setPower(null);
              }}
            />
          </div>
          </div>
          {world.over && (
            <GameReport
              world={world}
              onAgain={() => newGame(randomSeed())}
              onRetryTrial={() => {
                const def = world.trial && trialById(world.trial.id);
                if (def) startTrial(def);
              }}
              onOpenTrials={() => setShowTrials(true)}
            />
          )}
          {showTrials && <TrialsPanel onStart={startTrial} onClose={() => setShowTrials(false)} />}
          <Legend />
        </div>
        <div className="side">
          <Inspector world={world} selection={possessed ? { kind: 'unit', id: possessed.id } : selection} />
          <HeroPanel world={world} onSelect={(id) => setSelection({ kind: 'unit', id })} />
          <EventLog world={world} />
        </div>
      </div>
      <FactionPanel world={world} />
      {showRules && (
        <RulesPanel
          rules={rules}
          active={world.rules}
          onChange={changeRules}
          onNewGame={() => {
            setShowRules(false);
            newGame(randomSeed());
          }}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}

function cursorFor(world: World, power: PowerId | null, mouse: { x: number; y: number } | null): PowerCursor | null {
  if (!power || !mouse) return null;
  const def = POWER_DEFS[power];
  return {
    ...mouse,
    radius: def.radius,
    color: def.color,
    factionId: def.radius > 0 ? null : nearestFaction(world, mouse.x, mouse.y)?.id ?? null,
  };
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="lg-circle big" />戰士</span>
      <span><i className="lg-circle" />工人</span>
      <span><i className="lg-square" />鐵匠</span>
      <span><i className="lg-triangle" />外交官</span>
      <span><i className="lg-ellipse" />騎兵</span>
      <span><i className="lg-monster" />中立怪物（巢穴上標示寶藏：秘／寶／圖／龍）</span>
      <span><i className="lg-tile" style={{ background: '#3f7a3a' }} />森林</span>
      <span><i className="lg-tile" style={{ background: '#8a8f96' }} />石頭</span>
      <span><i className="lg-tile" style={{ background: '#e0904a' }} />鐵礦</span>
      <span><i className="lg-tile" style={{ background: '#d9465a' }} />漿果</span>
      <span className="muted">點擊小人或建築查看詳情 · 半透明＝撤退或隱身 · 土堆＝地底工兵 · 空白鍵暫停</span>
    </div>
  );
}
