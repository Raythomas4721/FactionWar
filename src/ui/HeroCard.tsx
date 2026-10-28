import { MAX_LEVEL, PATHS, TALENTS, XP_LEVELS } from '../sim/heroes';
import { TICKS_PER_SECOND } from '../sim/constants';
import { chooseTalent, heroSummary, possess, release, useSkill } from '../sim/systems/heroSystem';
import type { Unit, World } from '../sim/types';

/** 英雄的流派、等級、天賦、技能與附身控制 */
export function HeroCard({ world, u }: { world: World; u: Unit }) {
  const h = u.hero!;
  const path = PATHS[h.path];
  const next = h.level < MAX_LEVEL ? XP_LEVELS[h.level + 1] : null;
  const prev = XP_LEVELS[h.level];
  const progress = next === null ? 1 : (h.xp - prev) / (next - prev);
  const { combos } = heroSummary(world, u);

  return (
    <div className="hero-card">
      <div className="hero-head">
        <span className="hero-icon">{path.icon}</span>
        <b>
          {u.name}「{h.title}」
        </b>
        <span className="badge">{path.name}</span>
        <span className="hero-level">Lv{h.level}</span>
      </div>
      <div className="meter hero-xp" title={next === null ? '已達最高等級' : `經驗 ${h.xp}/${next}`}>
        <div style={{ width: `${Math.min(1, progress) * 100}%` }} />
      </div>
      <div className="muted hero-desc">{path.desc}</div>

      {h.choice && (
        <div className="hero-choice">
          <div className="hero-choice-title">升級了！選一個天賦：</div>
          {h.choice.map((t) => (
            <button key={t} onClick={() => chooseTalent(world, u, t)}>
              <b>{TALENTS[t].name}</b>
              <small>{TALENTS[t].desc}</small>
            </button>
          ))}
        </div>
      )}

      {h.talents.length > 0 && (
        <div className="hero-talents">
          {h.talents.map((t) => (
            <span key={t} className="talent" title={TALENTS[t].desc}>
              {TALENTS[t].name}
            </span>
          ))}
        </div>
      )}

      {combos.length > 0 && (
        <div className="hero-combos">
          {combos.map((c) => (
            <div key={c}>🔗 {c}</div>
          ))}
        </div>
      )}

      <div className="hero-actions">
        <button
          className="primary"
          disabled={h.skillCd > 0}
          title={path.skill.desc}
          onClick={() => useSkill(world, u)}
        >
          ⚡ {path.skill.name}
          {h.skillCd > 0 ? `（${Math.ceil(h.skillCd / TICKS_PER_SECOND)} 秒）` : ''}
        </button>
        {h.possessed ? (
          <button onClick={() => release(world)}>解除附身</button>
        ) : (
          <button onClick={() => possess(world, u)} title="親自操控這名英雄：點地圖移動、點敵人攻擊">
            👁 附身
          </button>
        )}
      </div>
      <div className="muted hero-skill-desc">技能：{path.skill.desc}</div>

      {h.deeds.length > 0 && (
        <details className="hero-deeds">
          <summary>英雄事蹟（{h.deeds.length}）</summary>
          <ul>
            {h.deeds.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
