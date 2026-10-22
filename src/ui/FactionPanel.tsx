import { BUILDING_DEFS } from '../sim/buildings';
import { MAX_TECH, TECH_THRESHOLDS } from '../sim/constants';
import { RACES } from '../sim/races';
import type { BuildingType, Faction, Resources, World } from '../sim/types';
import { RESOURCE_NAMES, factionBuildings, factionUnits, popCapOf } from '../sim/util';
import { score } from '../sim/world';

const RES_ORDER: (keyof Resources)[] = ['food', 'wood', 'stone', 'ore'];
const SHOWN_BUILDINGS: BuildingType[] = ['house', 'farm', 'forge', 'library', 'barracks', 'tower'];

export function FactionPanel({ world }: { world: World }) {
  return (
    <section className="factions">
      {world.factions.map((f) => (
        <FactionCard key={f.id} world={world} f={f} />
      ))}
    </section>
  );
}

function FactionCard({ world, f }: { world: World; f: Faction }) {
  const race = RACES[f.race];
  const units = factionUnits(world, f.id);
  const count = (r: string) => units.filter((u) => u.role === r).length;
  const buildings = factionBuildings(world, f.id).filter((b) => b.complete);
  const techProgress =
    f.tech >= MAX_TECH
      ? 1
      : (f.research - TECH_THRESHOLDS[f.tech]) / (TECH_THRESHOLDS[f.tech + 1] - TECH_THRESHOLDS[f.tech]);

  return (
    <div className={`panel faction-card ${f.alive ? '' : 'dead'}`} style={{ borderTopColor: f.color }}>
      <div className="fc-head">
        <span className="dot" style={{ background: f.color }} />
        <h3 style={{ color: f.color }}>{f.name}</h3>
        {!f.alive && <span className="badge dead-badge">已覆滅</span>}
        {f.alive && (
          <span className={`badge ${f.stance === 'attack' ? 'attack' : ''}`}>
            {f.stance === 'attack' && f.targetFaction !== null
              ? `進攻 ${world.factions[f.targetFaction].name}`
              : '防守'}
          </span>
        )}
        <span className="score">分數 {score(world, f)}</span>
      </div>

      <div className="fc-row">
        <span>人口 {units.length}/{popCapOf(world, f.id)}</span>
        <span className="muted">工人 {count('worker')} · 戰士 {count('warrior')} · 鐵匠 {count('smith')}</span>
      </div>

      <div className="fc-res">
        {RES_ORDER.map((k) => (
          <span key={k}>
            {RESOURCE_NAMES[k]} <b>{Math.floor(f.resources[k])}</b>
          </span>
        ))}
      </div>

      <div className="fc-row">
        <span>科技 Lv{f.tech}</span>
        <div className="meter">
          <div style={{ width: `${Math.min(1, techProgress) * 100}%`, background: f.color }} />
        </div>
      </div>

      <div className="fc-buildings">
        {SHOWN_BUILDINGS.map((t) => {
          const n = buildings.filter((b) => b.type === t).length;
          return (
            <span key={t} className={n ? '' : 'muted'} title={BUILDING_DEFS[t].desc}>
              {BUILDING_DEFS[t].name}×{n}
            </span>
          );
        })}
      </div>

      <div className="fc-row muted">
        <span>擊殺 {f.stats.kills} · 陣亡 {f.stats.deaths} · 打造 {f.stats.crafted} · 軍械庫 {f.armory.length}</span>
      </div>
      {f.stats.bestItem && <div className="fc-best">最佳裝備：{f.stats.bestItem.label}</div>}

      <ul className="traits">
        {race.traits.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
