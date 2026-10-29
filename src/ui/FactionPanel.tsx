import { BUILDING_DEFS } from '../sim/buildings';
import { MAX_TECH, TECH_THRESHOLDS, TICKS_PER_SECOND } from '../sim/constants';
import { eatersOf, upkeepOf } from '../sim/systems/health';
import { TREATY_ICONS, TREATY_NAMES, getTreaty } from '../sim/systems/treaties';
import { ATTR_KEYS, ATTR_LABELS, RACES } from '../sim/races';
import type { BuildingType, Faction, Resources, World } from '../sim/types';
import { RESOURCE_NAMES, factionBuildings, factionUnits, popCapOf } from '../sim/util';
import { score } from '../sim/world';
import { RELICS } from '../sim/lairs';
import { FactionCommands } from './FactionCommands';
import { unitVisible } from '../sim/fog';

const RES_ORDER: (keyof Resources)[] = ['food', 'wood', 'stone', 'ore'];
const SHOWN_BUILDINGS: BuildingType[] = ['house', 'farm', 'forge', 'library', 'barracks', 'infirmary', 'stable', 'tower'];

/** 戰爭迷霧中的敵國：只知道看得到的部分 */
function FoggedCard({ world, f }: { world: World; f: Faction }) {
  const seen = factionUnits(world, f.id).filter((u) => unitVisible(world, u));
  const warriors = seen.filter((u) => u.role === 'warrior').length;
  return (
    <div className="panel faction-card" style={{ borderTopColor: f.color }}>
      <div className="fc-head">
        <span className="dot" style={{ background: f.color }} />
        <h3 style={{ color: f.color }}>{f.name}</h3>
        <span className="badge">🌫 情報不足</span>
      </div>
      <p className="muted">
        目前看得到 {seen.length} 名敵人（戰士 {warriors}）。派斥候、佔領瞭望塔，才看得到更多敵情。
      </p>
    </div>
  );
}

export function FactionPanel({ world }: { world: World }) {
  return (
    <section className="factions">
      {world.factions.filter((f) => !f.neutral).map((f) => (
        <FactionCard key={f.id} world={world} f={f} />
      ))}
    </section>
  );
}

function FactionCard({ world, f }: { world: World; f: Faction }) {
  if (world.fog && f.alive && f.id !== world.fog.factionId) return <FoggedCard world={world} f={f} />;
  const race = RACES[f.race];
  const units = factionUnits(world, f.id);
  const count = (r: string) => units.filter((u) => u.role === r).length;
  const buildings = factionBuildings(world, f.id).filter((b) => b.complete);
  const sick = units.filter((u) => u.sick).length;
  const upkeepPerMin = upkeepOf(world, f, eatersOf(units)) * 60 * TICKS_PER_SECOND;
  const techProgress =
    f.tech >= MAX_TECH
      ? 1
      : (f.research - TECH_THRESHOLDS[f.tech]) / (TECH_THRESHOLDS[f.tech + 1] - TECH_THRESHOLDS[f.tech]);

  return (
    <div
      className={`panel faction-card ${f.alive ? '' : 'dead'} ${f.playerControlled ? 'controlled' : ''}`}
      style={{ borderTopColor: f.color }}
    >
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

      {f.alive && !world.kingdom && (
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={f.playerControlled}
            onChange={(e) => {
              f.playerControlled = e.target.checked;
            }}
          />
          🎮 由我指揮
        </label>
      )}
      {f.alive && f.playerControlled && <FactionCommands world={world} f={f} />}

      <div className="fc-row">
        <span>人口 {units.length}/{popCapOf(world, f.id)}</span>
        <span className="muted">
          工人 {count('worker')} · 戰士 {count('warrior')} · 鐵匠 {count('smith')} · 外交官 {count('diplomat')}
        </span>
      </div>

      {f.alive && (
        <div className="relations">
          {world.factions
            .filter((o) => o.id !== f.id && o.alive)
            .map((o) => {
              const t = getTreaty(world, f.id, o.id);
              const truce = world.truceUntil[f.id]?.[o.id] ?? 0;
              return (
                <span
                  key={o.id}
                  className={`rel rel-${t}`}
                  title={`${TREATY_NAMES[t]}${truce ? '（神諭停戰）' : ''}｜對 ${o.name} 的觀感 ${Math.round(f.relations[o.id])}`}
                >
                  <i className="dot" style={{ background: o.color }} />
                  {TREATY_ICONS[t]} {Math.round(f.relations[o.id])}
                </span>
              );
            })}
        </div>
      )}

      {f.alive && (sick > 0 || f.starving) && (
        <div className="fc-row health-row">
          {sick > 0 && <span className="sick-badge">☣ 患病 {sick}</span>}
          {f.starving && <span className="starve-badge">🍞 飢荒中</span>}
        </div>
      )}

      <div className="fc-res">
        {RES_ORDER.map((k) => (
          <span key={k}>
            {RESOURCE_NAMES[k]} <b>{Math.floor(f.resources[k])}</b>
          </span>
        ))}
        <span className="muted" title="全族每分鐘吃掉的糧食">口糧 {Math.round(upkeepPerMin)}/分</span>
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
        <span>染病 {f.stats.infections} · 病死 {f.stats.diseaseDeaths} · 餓死 {f.stats.starved}</span>
        <span>招降 {f.stats.recruited} · 叛逃 {f.stats.defected} · 締約 {f.stats.treaties} · 發明 {f.stats.inventions}</span>
      </div>
      {f.stats.bestItem && <div className="fc-best">最佳裝備：{f.stats.bestItem.label}</div>}
      {f.relics.length > 0 && (
        <div className="fc-relics" title={f.relics.map((r) => `${RELICS[r].name}：${RELICS[r].desc}`).join('\n')}>
          🏆 秘術：{f.relics.map((r) => RELICS[r].name).join('、')}
        </div>
      )}
      {ATTR_KEYS.some((k) => f.attrBonus[k] > 0) && (
        <div className="fc-relics">
          💊 秘藥：
          {ATTR_KEYS.filter((k) => f.attrBonus[k] > 0)
            .map((k) => `${ATTR_LABELS[k]} +${f.attrBonus[k]}`)
            .join('、')}
        </div>
      )}
      {f.blueprints.length > 0 && (
        <div className="fc-blueprints" title={f.blueprints.map((b) => `${b.name}（威力 ×${b.powerMult?.toFixed(2)}）`).join('\n')}>
          💡 藍圖 {f.blueprints.length}：{f.blueprints.map((b) => b.name).join('、')}
        </div>
      )}

      <ul className="traits">
        {race.traits.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
