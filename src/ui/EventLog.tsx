import { useState } from 'react';
import type { EventKind, World } from '../sim/types';
import { formatTime } from './ControlBar';

const ICONS: Record<EventKind, string> = {
  combat: '⚔',
  craft: '⚒',
  build: '🏠',
  tech: '📜',
  faction: '🚩',
  god: '✨',
  health: '☣',
  info: 'ℹ',
};

const FILTERS: { label: string; kinds: EventKind[] | null }[] = [
  { label: '全部', kinds: null },
  { label: '戰鬥', kinds: ['combat', 'faction'] },
  { label: '神蹟', kinds: ['god'] },
  { label: '民生', kinds: ['health'] },
  { label: '打造', kinds: ['craft'] },
  { label: '建設', kinds: ['build', 'tech'] },
];

export function EventLog({ world }: { world: World }) {
  const [filter, setFilter] = useState(0);
  const kinds = FILTERS[filter].kinds;
  const events = world.events.filter((e) => !kinds || kinds.includes(e.kind)).slice(-80).reverse();
  return (
    <section className="panel event-log">
      <div className="panel-head">
        <h2>事件日誌</h2>
        <div className="tabs">
          {FILTERS.map((f, i) => (
            <button key={f.label} className={i === filter ? 'active' : ''} onClick={() => setFilter(i)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul>
        {events.map((e, i) => (
          <li key={`${e.tick}-${i}`} className={`ev-${e.kind}`}>
            <span className="ev-time">{formatTime(e.tick)}</span>
            <span className="ev-icon">{ICONS[e.kind]}</span>
            <span style={{ color: e.factionId >= 0 ? world.factions[e.factionId]?.color : undefined }}>{e.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
