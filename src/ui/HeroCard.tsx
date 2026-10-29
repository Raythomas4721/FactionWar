import { MAX_LEVEL, PATHS, TALENTS, XP_LEVELS } from '../sim/heroes';
import { canPossess, chooseTalent, heroSummary, possess, release } from '../sim/systems/heroSystem';
import { SkillButtons } from './SkillButtons';
import type { Unit, World } from '../sim/types';

/** 英雄的流派、等級、天賦、技能與附身控制 */
export function HeroCard({ world, u }: { world: World; u: Unit }) {
  const h = u.hero!;
  const path = PATHS[h.path];
  const next = h.level < MAX_LEVEL ? XP_LEVELS[h.level + 1] : null;
  const prev = XP_LEVELS[h.level];
  const progress = next === null ? 1 : (h.xp - prev) / (next - prev);
  const { combos } = heroSummary(world, u);
  const nemeses = world.factions[u.factionId].nemeses;

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
        <SkillButtons world={world} u={u} />
        {h.possessed ? (
          <button onClick={() => release(world)}>解除附身</button>
        ) : canPossess(world, u) && (
          <button onClick={() => possess(world, u)} title="親自操控這名英雄：點地圖移動、點敵人攻擊">
            👁 附身
          </button>
        )}
      </div>
      <div className="muted hero-skill-desc">
        Q {path.skill.name}：{path.skill.desc}
        <br />W {path.skill2.name}（Lv3）：{path.skill2.desc}
        <br />E {path.ult.name}（Lv5 大招）：{path.ult.desc}
      </div>
      {nemeses.length > 0 && (
        <div className="nemesis-note">
          ☠ {world.factions[u.factionId].name}的宿敵：
          {nemeses.map((n) => `${n.name}（仇恨 ${n.grudge}）`).join('、')}
        </div>
      )}

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
