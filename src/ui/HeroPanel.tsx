import { useState } from 'react';
import { PATHS } from '../sim/heroes';
import type { World } from '../sim/types';
import { formatTime } from './ControlBar';

/** 英雄榜：在世的英雄與戰死的傳奇 */
export function HeroPanel({ world, onSelect }: { world: World; onSelect: (unitId: number) => void }) {
  const [tab, setTab] = useState<'alive' | 'fallen' | 'nemesis'>('alive');
  const nemeses = world.factions.flatMap((f) => f.nemeses.map((n) => ({ hunter: f, n })));
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
          <button className={tab === 'nemesis' ? 'active' : ''} onClick={() => setTab('nemesis')}>
            ☠ 宿敵 {nemeses.length}
          </button>
        </div>
      </div>
      {tab === 'nemesis' ? (
        nemeses.length ? (
          <ul className="hero-list">
            {nemeses
              .sort((a, b) => b.n.grudge - a.n.grudge)
              .map(({ hunter, n }) => (
                <li key={`${hunter.id}-${n.unitId}`} onClick={() => onSelect(n.unitId)} title={`殺死了：${n.victims.join('、')}`}>
                  <span style={{ color: world.factions[n.factionId].color }}>☠</span>
                  <span>{n.name}</span>
                  <span className="muted">
                    <span style={{ color: hunter.color }}>{hunter.name}</span>的仇人 · 仇恨 {n.grudge}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted">殺死某個陣營英雄的敵人，會成為那個陣營的宿敵。</p>
        )
      ) : tab === 'alive' ? (
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
