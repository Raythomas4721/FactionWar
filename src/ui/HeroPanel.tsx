import { useState } from 'react';
import { PATHS } from '../sim/heroes';
import type { World } from '../sim/types';
import { formatTime } from './ControlBar';

/** 英雄榜：在世的英雄與戰死的傳奇 */
export function HeroPanel({ world, onSelect }: { world: World; onSelect: (unitId: number) => void }) {
  const [tab, setTab] = useState<'alive' | 'fallen'>('alive');
  const heroes = world.units
    .filter((u) => u.hp > 0 && u.hero)
    .sort((a, b) => b.hero!.level - a.hero!.level || b.kills - a.kills);
  const legends = [...world.legends].reverse();

  return (
    <section className="panel hero-panel">
      <div className="panel-head">
        <h2>⭐ 英雄榜</h2>
        <div className="tabs">
          <button className={tab === 'alive' ? 'active' : ''} onClick={() => setTab('alive')}>
            在世 {heroes.length}
          </button>
          <button className={tab === 'fallen' ? 'active' : ''} onClick={() => setTab('fallen')}>
            傳奇 {legends.length}
          </button>
        </div>
      </div>
      {tab === 'alive' ? (
        heroes.length ? (
          <ul className="hero-list">
            {heroes.map((u) => {
              const f = world.factions[u.factionId];
              const h = u.hero!;
              return (
                <li key={u.id} onClick={() => onSelect(u.id)} className={h.possessed ? 'possessed' : ''}>
                  <span style={{ color: f.color }}>{PATHS[h.path].icon}</span>
                  <span>
                    {u.name}「{h.title}」
                  </span>
                  <span className="muted">
                    Lv{h.level} · 擊殺 {u.kills}
                    {h.choice ? ' · 待選天賦' : ''}
                    {h.possessed ? ' · 👁' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">戰士擊殺 4 人就會晉升為英雄。</p>
        )
      ) : legends.length ? (
        <ul className="hero-list">
          {legends.slice(0, 12).map((l, i) => (
            <li key={i} title={l.deeds.join('\n')}>
              <span style={{ color: world.factions[l.factionId].color }}>🕯</span>
              <span>
                {l.name}「{l.title}」
              </span>
              <span className="muted">
                Lv{l.level} {PATHS[l.path].name} · 擊殺 {l.kills} · {formatTime(l.diedAt)} {l.cause}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">還沒有英雄戰死。</p>
      )}
    </section>
  );
}
