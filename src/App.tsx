import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanvasRenderer, TILE_PX, clampCamera, pickAt, screenToTile, type Camera, type PowerCursor, type Selection,
} from './render/canvasRenderer';
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
import {
  SQUAD_SIZE, commandHero, possessedHero, release, setRally, squadOf, useSkill,
} from './sim/systems/heroSystem';
import { createTrialWorld, trialById, type TrialDef } from './sim/trials';
import { TrialsPanel, saveTrialRecord } from './ui/TrialsPanel';
import { EventsBar, TrialBanner } from './ui/WorldBanners';
import { SkillButtons } from './ui/SkillButtons';
import { HeroTouchControls, MapControls, MobileTabs, type MobileTab } from './ui/MapOverlays';
import { useIsMobile } from './ui/useIsMobile';
import { createKingdomWorld, kingdomOutcome, type KingdomSetup } from './sim/kingdom';
import { expandKingdom } from './sim/expansion';
import { KingdomSetupPanel, saveKingdomWin } from './ui/KingdomSetup';
import { KingdomBar, PolicyOffer } from './ui/KingdomBar';
import { setScoutTarget } from './sim/fog';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const MAX_STEPS_PER_FRAME = 400;
const UI_REFRESH_MS = 200;
const RULES_KEY = 'factionwar.rules';
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** 手指移動超過這個距離就算拖曳，不算點擊 */
const DRAG_THRESHOLD = 6;

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

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const fullView = (world: World): Camera => ({ x: world.width / 2, y: world.height / 2, zoom: 1 });

interface Gesture {
  pointers: Map<number, { x: number; y: number }>;
  start: { x: number; y: number };
  startCam: Camera;
  startDist: number;
  moved: boolean;
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
  const [showKingdom, setShowKingdom] = useState(false);
  const [offerLater, setOfferLater] = useState(false);
  const [scoutMode, setScoutMode] = useState(false);
  const kingdomSetupRef = useRef<KingdomSetup | null>(null);
  const savedKingdomRef = useRef<World | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('inspect');
  const mobile = useIsMobile();
  const savedTrialRef = useRef<World | null>(null);
  const [, setUiTick] = useState(0);

  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const selectionRef = useRef(selection);
  const powerRef = useRef(power);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  // 鏡頭：附身時跟隨英雄；否則可以自己拖曳、縮放（manual），都沒有就是全景
  const cameraRef = useRef<Camera | null>(null);
  const manualCamRef = useRef<Camera | null>(null);
  const [follow, setFollow] = useState(true);
  const [heroZoom, setHeroZoom] = useState(2.2);
  const followRef = useRef(follow);
  const heroZoomRef = useRef(heroZoom);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);
  followRef.current = follow;
  heroZoomRef.current = heroZoom;
  speedRef.current = speed;
  // 國策卡出現時暫停，讓玩家慢慢想（按「稍後再選」可以先繼續）
  const offerOpen = !!worldRef.current.kingdom?.offer && !offerLater && !worldRef.current.over;
  pausedRef.current = paused || showRules || showTrials || showKingdom || offerOpen;
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
      cameraRef.current = updateCamera(world, cameraRef.current, followRef.current, heroZoomRef.current, manualCamRef.current);
      renderer.draw(world, selectionRef.current, cursorFor(world, powerRef.current, mouseRef.current), cameraRef.current);
      if (now - lastUi > UI_REFRESH_MS) {
        lastUi = now;
        setUiTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 開發模式的除錯工具：在主控台查看世界、快轉模擬
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const dev = window as unknown as { __world: () => World; __step: (n: number) => number; __camera: () => Camera | null };
    dev.__world = () => worldRef.current;
    dev.__camera = () => cameraRef.current;
    dev.__step = (n: number) => {
      for (let i = 0; i < n && !worldRef.current.over; i++) step(worldRef.current);
      return worldRef.current.tick;
    };
  }, []);

  const following = () => !!possessedHero(worldRef.current) && followRef.current;

  /** 放大縮小：附身跟隨時調整跟隨倍率，否則調整自由鏡頭（以畫面某一點為中心） */
  const zoomBy = useCallback((factor: number, fx = 0.5, fy = 0.5) => {
    const world = worldRef.current;
    if (following()) {
      setHeroZoom((z) => Math.min(MAX_ZOOM, Math.max(1.2, z * factor)));
      return;
    }
    // 以目標鏡頭為準（鏡頭還在平滑移動時連按也能正確累加）
    const cam = manualCamRef.current ?? cameraRef.current ?? fullView(world);
    const zoom = clampZoom(cam.zoom * factor);
    if (zoom <= 1.02) {
      manualCamRef.current = null;
      return;
    }
    // 讓手指／滑鼠底下的那一點保持不動
    const p = screenToTile(world, cam, fx, fy);
    manualCamRef.current = clampCamera(world, {
      zoom,
      x: p.x - ((fx - 0.5) * world.width) / zoom,
      y: p.y - ((fy - 0.5) * world.height) / zoom,
    });
  }, []);

  const resetView = () => {
    if (possessedHero(worldRef.current)) setFollow((f) => !f);
    manualCamRef.current = null;
  };

  // 滑鼠滾輪縮放（需要非被動監聽才能阻止頁面捲動）
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // 快捷鍵：1–9 選神力、Esc 取消、空白鍵暫停、QWE 技能、F 跟隨我、+/- 縮放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < POWER_ORDER.length && !worldRef.current.kingdom) setPower((p) => (p === POWER_ORDER[idx] ? null : POWER_ORDER[idx]));
      else if (e.key === 'Escape') {
        setPower(null);
        setScoutMode(false);
        release(worldRef.current);
      } else if (['q', 'w', 'e'].includes(e.key.toLowerCase())) {
        const hero = possessedHero(worldRef.current);
        const slot = ({ q: 1, w: 2, e: 3 } as const)[e.key.toLowerCase() as 'q' | 'w' | 'e'];
        if (hero) useSkill(worldRef.current, hero, slot);
      } else if (e.key === 'f' || e.key === 'F') {
        const hero = possessedHero(worldRef.current);
        if (hero?.hero) setRally(worldRef.current, hero, !hero.hero.rally);
      } else if (e.key === '+' || e.key === '=') {
        zoomBy(1.25);
      } else if (e.key === '-') {
        zoomBy(1 / 1.25);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy]);

  const newGame = useCallback(
    (seed: number) => {
      worldRef.current = createWorld(seed, { rules });
      kingdomSetupRef.current = null;
      manualCamRef.current = null;
      setSelection(null);
      setPaused(false);
      setCastMsg(null);
    },
    [rules],
  );

  const startKingdom = useCallback((setup: KingdomSetup) => {
    worldRef.current = createKingdomWorld(setup);
    kingdomSetupRef.current = setup;
    manualCamRef.current = null;
    setSelection(null);
    setPaused(false);
    setPower(null);
    setOfferLater(false);
    const k = worldRef.current.kingdom!;
    setCastMsg({ ok: true, text: `王國模式：${worldRef.current.factions[k.player].name} 對 ${worldRef.current.factions[k.enemy].name}` });
    setShowKingdom(false);
  }, []);

  const startTrial = useCallback((def: TrialDef) => {
    worldRef.current = createTrialWorld(def);
    kingdomSetupRef.current = null;
    manualCamRef.current = null;
    setSelection(null);
    setPaused(false);
    setPower(null);
    setCastMsg({ ok: true, text: `試煉開始：${def.goal}` });
    setShowTrials(false);
  }, []);

  const changeRules = (next: WorldRules) => {
    setRules(next);
    saveRules(next);
    // 即時規則直接套用；地圖與開局科技要等新局。王國模式有自己固定的規則（含 1v1 平衡），不受影響
    const world = worldRef.current;
    if (world.kingdom) return;
    world.rules = { ...next, resourceRichness: world.rules.resourceRichness, startTech: world.rules.startTech };
    world.maxTicks = maxTicksOf(world.rules);
  };

  const toTile = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const world = worldRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    return screenToTile(world, cameraRef.current, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  // ── 觸控與滑鼠拖曳：單指拖曳移動地圖、雙指縮放 ──
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 某些瀏覽器或模擬事件不支援捕捉，拖曳照樣可用
    }
    const cam = manualCamRef.current ?? cameraRef.current ?? fullView(worldRef.current);
    const g = gestureRef.current ?? { pointers: new Map(), start: { x: 0, y: 0 }, startCam: cam, startDist: 0, moved: false };
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.start = { x: e.clientX, y: e.clientY };
    g.startCam = cam;
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    gestureRef.current = g;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse') mouseRef.current = toTile(e);
    const g = gestureRef.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const world = worldRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    if (g.pointers.size === 1) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.moved = true;
      if (g.startCam.zoom <= 1.01) return; // 全景時沒有地方可以拖
      if (followRef.current && possessedHero(world)) setFollow(false);
      const pxPerTile = (rect.width / world.width) * g.startCam.zoom;
      manualCamRef.current = clampCamera(world, {
        zoom: g.startCam.zoom,
        x: g.startCam.x - dx / pxPerTile,
        y: g.startCam.y - dy / pxPerTile,
      });
    } else if (g.pointers.size === 2 && g.startDist > 0) {
      g.moved = true;
      const [a, b] = [...g.pointers.values()];
      const zoom = clampZoom((g.startCam.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist);
      if (followRef.current && possessedHero(world)) setFollow(false);
      manualCamRef.current = zoom <= 1.02 ? null : clampCamera(world, { ...g.startCam, zoom });
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 0) {
      suppressClickRef.current = g.moved;
      gestureRef.current = null;
    } else {
      // 雙指變單指：從剩下那根手指重新開始拖曳
      const [rest] = [...g.pointers.values()];
      g.start = rest;
      g.startCam = manualCamRef.current ?? cameraRef.current ?? fullView(worldRef.current);
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const world = worldRef.current;
    const { x, y } = toTile(e);
    if (scoutMode && world.fog) {
      setScoutTarget(world, x, y);
      setScoutMode(false);
      setCastMsg({ ok: true, text: '🔭 斥候前往偵察指定地點' });
      return;
    }
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
    const tilePx = (e.currentTarget.getBoundingClientRect().width / world.width) * (cameraRef.current?.zoom ?? 1);
    const picked = pickAt(world, x, y, Math.max(0.9, 14 / tilePx));
    setSelection(picked);
    if (picked && mobile) setMobileTab('inspect');
  };

  const world = worldRef.current;
  const possessed = possessedHero(world);
  // 玩家選完國策後，下一張卡出現時要重新跳出來
  if (offerLater && !world.kingdom?.offer) setOfferLater(false);
  // 王國模式打贏時記錄（每個世界只記一次）
  if (kingdomOutcome(world) === 'won' && savedKingdomRef.current !== world) {
    savedKingdomRef.current = world;
    const k = world.kingdom!;
    saveKingdomWin(world.factions[k.player].race, k.difficulty);
  }
  // 通過試煉時記錄最佳時間（每個世界只記一次）
  if (world.trial?.status === 'won' && savedTrialRef.current !== world) {
    savedTrialRef.current = world;
    saveTrialRecord(world.trial.id, world.tick);
  }
  const inspected: Selection | null = possessed ? { kind: 'unit', id: possessed.id } : selection;
  const selectHero = (id: number) => {
    setSelection({ kind: 'unit', id });
    if (mobile) setMobileTab('inspect');
  };

  return (
    <div className={`app ${mobile ? 'mobile' : ''}`}>
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
        onOpenKingdom={() => setShowKingdom(true)}
      />
      <div className="main">
        <div className="board">
          <TrialBanner world={world} onQuit={() => newGame(randomSeed())} />
          {world.kingdom ? (
            <KingdomBar
              world={world}
              message={castMsg}
              onOpenOffer={() => setOfferLater(false)}
              scoutMode={scoutMode}
              onScoutMode={setScoutMode}
            />
          ) : (
            <GodBar world={world} selected={power} onSelect={setPower} message={castMsg} />
          )}
          <EventsBar world={world} />
          {possessed?.hero && !mobile && (
            <div className="possess-bar">
              <span>
                👁 附身中：<b>{possessed.name}「{possessed.hero.title}」</b>
                <span className="muted"> 點地圖移動、點敵人攻擊</span>
              </span>
              <span className="spacer" />
              <SkillButtons world={world} u={possessed} />
              <button
                className={possessed.hero.rally ? 'active' : ''}
                title="附近的戰士跟著英雄作戰（F）"
                onClick={() => setRally(world, possessed, !possessed.hero!.rally)}
              >
                🚩 {possessed.hero.rally ? `小隊 ${squadOf(world, possessed).length}/${SQUAD_SIZE}` : '跟隨我 (F)'}
              </button>
              <button onClick={() => release(world)}>解除 (Esc)</button>
            </div>
          )}
          <div className="canvas-wrap" style={{ aspectRatio: `${world.width * TILE_PX} / ${world.height * TILE_PX}` }}>
            <canvas
              ref={canvasRef}
              className={power || scoutMode ? 'casting' : ''}
              onClick={onCanvasClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onMouseLeave={() => (mouseRef.current = null)}
              onContextMenu={(e) => {
                if (!power) return;
                e.preventDefault();
                setPower(null);
              }}
            />
            <MapControls
              onZoomIn={() => zoomBy(1.3)}
              onZoomOut={() => zoomBy(1 / 1.3)}
              onReset={resetView}
              following={!!possessed && follow}
            />
          </div>
          {possessed?.hero && mobile && <HeroTouchControls world={world} hero={possessed} />}
          {world.over && (
            <GameReport
              world={world}
              onAgain={() => newGame(randomSeed())}
              onRetryTrial={() => {
                const def = world.trial && trialById(world.trial.id);
                if (def) startTrial(def);
              }}
              onOpenTrials={() => setShowTrials(true)}
              onKingdomAgain={() => {
                const setup = kingdomSetupRef.current;
                if (setup) startKingdom({ ...setup, seed: randomSeed() });
              }}
              onOpenKingdom={() => setShowKingdom(true)}
              onExpand={() => {
                expandKingdom(worldRef.current);
                setSelection(null);
                resetView();
              }}
            />
          )}
          {!mobile && <Legend />}
        </div>
        <div className="side">
          {(!mobile || mobileTab === 'inspect') && <Inspector world={world} selection={inspected} />}
          {(!mobile || mobileTab === 'heroes') && <HeroPanel world={world} onSelect={selectHero} />}
          {(!mobile || mobileTab === 'log') && <EventLog world={world} />}
          {mobile && mobileTab === 'factions' && (
            <>
              <FactionPanel world={world} />
              <Legend />
            </>
          )}
        </div>
      </div>
      {!mobile && <FactionPanel world={world} />}
      {mobile && <MobileTabs tab={mobileTab} onTab={setMobileTab} />}
      {offerOpen && <PolicyOffer world={world} onLater={() => setOfferLater(true)} />}
      {showKingdom && <KingdomSetupPanel onStart={startKingdom} onClose={() => setShowKingdom(false)} />}
      {showTrials && <TrialsPanel onStart={startTrial} onClose={() => setShowTrials(false)} />}
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

/**
 * 鏡頭：附身跟隨時平滑移向英雄；有自由鏡頭時移向自由鏡頭；都沒有就平滑拉回全景。
 */
function updateCamera(world: World, cam: Camera | null, follow: boolean, zoom: number, manual: Camera | null): Camera | null {
  const hero = possessedHero(world);
  const from = cam ?? fullView(world);
  const lerp = (to: Camera, ease: number): Camera => ({
    x: from.x + (to.x - from.x) * ease,
    y: from.y + (to.y - from.y) * ease,
    zoom: from.zoom + (to.zoom - from.zoom) * ease,
  });
  if (hero && follow) return clampCamera(world, lerp({ x: hero.x, y: hero.y, zoom }, 0.15));
  if (manual) return clampCamera(world, lerp(manual, 0.45));
  if (!cam) return null;
  const next = lerp(fullView(world), 0.15);
  return next.zoom < 1.01 ? null : clampCamera(world, next);
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
      <span><i className="lg-outpost" />據點（礦／望／祠，站上去就能佔領）</span>
      <span><i className="lg-tile" style={{ background: '#3f7a3a' }} />森林</span>
      <span><i className="lg-tile" style={{ background: '#8a8f96' }} />石頭</span>
      <span><i className="lg-tile" style={{ background: '#e0904a' }} />鐵礦</span>
      <span><i className="lg-tile" style={{ background: '#d9465a' }} />漿果</span>
      <span className="muted">
        點擊小人或建築查看詳情 · 拖曳移動地圖、滾輪或雙指縮放 · 半透明＝撤退或隱身 · 土堆＝地底工兵 · 空白鍵暫停
      </span>
    </div>
  );
}
