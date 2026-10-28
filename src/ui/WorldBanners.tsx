import { TICKS_PER_SECOND } from '../sim/constants';
import { WORLD_EVENTS } from '../sim/events';
import { POWER_DEFS } from '../sim/powers';
import { trialById } from '../sim/trials';
import type { World } from '../sim/types';

/** 進行中的試煉：目標、進度與可用神力 */
export function TrialBanner({ world, onQuit }: { world: World; onQuit: () => void }) {
  const t = world.trial;
  const def = t ? trialById(t.id) : undefined;
  if (!t || !def) return null;
  return (
    <div className="trial-banner">
      <span className="trial-icon">{def.icon}</span>
      <div className="trial-banner-text">
        <b>試煉：{def.name}</b>
        <span>🎯 {def.goal}</span>
        <span className="trial-progress">{def.progress(world)}</span>
        <span className="muted">可用神力：{def.powers.map((p) => POWER_DEFS[p].icon + POWER_DEFS[p].name).join('、')}</span>
      </div>
      <button onClick={onQuit}>放棄</button>
    </div>
  );
}

/** 進行中的世界事件 */
export function EventsBar({ world }: { world: World }) {
  const active = world.activeEvents.filter((e) => world.tick < e.until);
  if (!active.length) return null;
  return (
    <div className="events-bar">
      {active.map((e) => {
        const def = WORLD_EVENTS[e.id];
        return (
          <span key={e.id} className="event-chip" title={def.desc}>
            {def.icon} {def.name}
            <small>{Math.ceil((e.until - world.tick) / TICKS_PER_SECOND)}s</small>
          </span>
        );
      })}
    </div>
  );
}
