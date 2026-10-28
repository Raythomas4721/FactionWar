import { TICKS_PER_SECOND } from '../sim/constants';
import { SKILL_KEYS, SKILL_UNLOCK, skillOf, type SkillSlot } from '../sim/heroes';
import { SQUAD_SIZE, release, setRally, skillCooldown, squadOf, useSkill } from '../sim/systems/heroSystem';
import type { Unit, World } from '../sim/types';

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  following: boolean;
}

/** 地圖右上角的縮放按鈕（所有裝置） */
export function MapControls({ onZoomIn, onZoomOut, onReset, following }: MapControlsProps) {
  return (
    <div className="map-controls">
      <button onClick={onZoomIn} aria-label="放大">＋</button>
      <button onClick={onZoomOut} aria-label="縮小">－</button>
      <button onClick={onReset} aria-label={following ? '看全景' : '重置鏡頭'} title={following ? '看全景' : '重置鏡頭'}>
        {following ? '🗺' : '⟲'}
      </button>
    </div>
  );
}

const SLOTS: SkillSlot[] = [1, 2, 3];

/** 手機上附身英雄時，地圖下方的大顆技能鍵（不遮住地圖，拇指也按得到） */
export function HeroTouchControls({ world, hero }: { world: World; hero: Unit }) {
  const h = hero.hero!;
  return (
    <div className="touch-strip">
      <div className="hero-chip">
        <b>👁 {hero.name}</b>
        <div className="meter">
          <div style={{ width: `${(hero.hp / hero.maxHp) * 100}%`, background: '#6ee06e' }} />
        </div>
        <small>Lv{h.level}</small>
      </div>
      <div className="touch-skills">
        {SLOTS.map((slot) => {
          const locked = h.level < SKILL_UNLOCK[slot];
          const cd = skillCooldown(hero, slot);
          const def = skillOf(h.path, slot);
          return (
            <button
              key={slot}
              className={`touch-btn ${slot === 3 ? 'ult' : ''} ${!locked && cd <= 0 ? 'ready' : ''}`}
              disabled={locked || cd > 0}
              onClick={() => useSkill(world, hero, slot)}
              aria-label={def.name}
            >
              <span className="touch-name">{def.name}</span>
              <span className="touch-sub">
                {locked ? `🔒${SKILL_UNLOCK[slot]}` : cd > 0 ? `${Math.ceil(cd / TICKS_PER_SECOND)}s` : SKILL_KEYS[slot]}
              </span>
            </button>
          );
        })}
        <button
          className={`touch-btn small ${h.rally ? 'ready' : ''}`}
          onClick={() => setRally(world, hero, !h.rally)}
          aria-label="跟隨我"
        >
          🚩
          <span className="touch-sub">{h.rally ? `${squadOf(world, hero).length}/${SQUAD_SIZE}` : '跟隨'}</span>
        </button>
        <button className="touch-btn small" onClick={() => release(world)} aria-label="解除附身">
          ✕<span className="touch-sub">解除</span>
        </button>
      </div>
    </div>
  );
}

export type MobileTab = 'inspect' | 'heroes' | 'log' | 'factions';

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: 'inspect', icon: '🔍', label: '檢視' },
  { id: 'heroes', icon: '⭐', label: '英雄' },
  { id: 'log', icon: '📜', label: '日誌' },
  { id: 'factions', icon: '🏰', label: '陣營' },
];

/** 手機底部的分頁列：一次只看一個面板，不用一直往下捲 */
export function MobileTabs({ tab, onTab }: { tab: MobileTab; onTab: (t: MobileTab) => void }) {
  return (
    <nav className="mobile-tabs">
      {TABS.map((t) => (
        <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => onTab(t.id)}>
          <span>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
