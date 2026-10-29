import { useState } from 'react';
import type { EventKind, GameEvent, World } from '../sim/types';
import { formatTime } from './ControlBar';
import { RACES } from '../sim/races';

const ICONS: Record<EventKind, string> = {
  combat: '⚔',
  craft: '⚒',
  invention: '💡',
  build: '🏠',
  tech: '📜',
  faction: '🚩',
  god: '✨',
  health: '☣',
  diplomacy: '🕊',
  lair: '🏆',
  hero: '⭐',
  world: '🌍',
  policy: '📜',
  info: 'ℹ',
};

const FILTERS: { label: string; kinds: EventKind[] | null }[] = [
  { label: '全部', kinds: null },
  { label: '英雄', kinds: ['hero'] },
  { label: '國策', kinds: ['policy'] },
  { label: '天象', kinds: ['world'] },
  { label: '戰鬥', kinds: ['combat', 'faction', 'lair'] },
  { label: '神蹟', kinds: ['god'] },
  { label: '民生', kinds: ['health'] },
  { label: '外交', kinds: ['diplomacy'] },
  { label: '打造', kinds: ['craft', 'invention'] },
  { label: '建設', kinds: ['build', 'tech'] },
];

/**
 * 戰爭迷霧中，敵國內政（打造、建設、科技、疫病）的消息傳不過來；
 * 別人之間的戰鬥也只聽得到和自己有關的。
 */
const SECRET_KINDS: EventKind[] = ['craft', 'invention', 'build', 'tech', 'health', 'info'];
const RUMOR_KINDS: EventKind[] = ['combat', 'lair', 'hero'];
function fogHidden(world: World, e: GameEvent): boolean {
  const fog = world.fog;
  if (!fog || e.factionId < 0 || e.factionId === fog.factionId) return false;
  if (SECRET_KINDS.includes(e.kind)) return true;
  const me = world.factions[fog.factionId];
  return RUMOR_KINDS.includes(e.kind) && !e.text.includes(RACES[me.race].name) && !e.text.includes(me.name);
}

export function EventLog({ world }: { world: World }) {
  const [filter, setFilter] = useState(0);
  const kinds = FILTERS[filter].kinds;
  const events = world.events
    .filter((e) => (!kinds || kinds.includes(e.kind)) && !fogHidden(world, e))
    .slice(-80)
    .reverse();
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
