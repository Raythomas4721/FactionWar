import { ATTR_LABELS, RACES, RACE_ORDER } from '../sim/races';
import { DEFAULT_RULES, RULE_DEFS, type WorldRules } from '../sim/rules';

interface Props {
  rules: WorldRules;
  /** 目前這一局實際採用的規則（用來標出「新局才生效」的差異） */
  active: WorldRules;
  onChange: (rules: WorldRules) => void;
  onNewGame: () => void;
  onClose: () => void;
}

export function RulesPanel({ rules, active, onChange, onNewGame, onClose }: Props) {
  const pending =
    RULE_DEFS.some((d) => !d.live && rules[d.key] !== active[d.key]) ||
    rules.raceSelection.join() !== active.raceSelection.join() ||
    rules.neutralLairs !== active.neutralLairs;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>世界法則</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <p className="muted">大部分規則會立刻套用到目前的戰局；標示「新局」的要開新局才生效。</p>

        <div className="rules">
          {RULE_DEFS.map((d) => (
            <label key={d.key} className="rule">
              <span className="rule-name">
                {d.label}
                {!d.live && <em className="new-game-tag">新局</em>}
              </span>
              <input
                type="range"
                min={d.min}
                max={d.max}
                step={d.step}
                value={rules[d.key]}
                onChange={(e) => onChange({ ...rules, [d.key]: Number(e.target.value) })}
              />
              <span className="rule-val">{d.format(rules[d.key])}</span>
            </label>
          ))}
        </div>

        <h3>
          參戰種族<em className="new-game-tag">新局</em>
        </h3>
        <p className="muted">最多選 4 族；沒選滿的由六族中隨機補上（全不選＝每局隨機）。</p>
        <div className="race-picks">
          {RACE_ORDER.map((race) => {
            const on = rules.raceSelection.includes(race);
            const full = rules.raceSelection.length >= 4;
            return (
              <label key={race} className={`race-pick ${on ? 'on' : ''}`} style={{ borderColor: RACES[race].color }}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && full}
                  onChange={(e) =>
                    onChange({
                      ...rules,
                      raceSelection: e.target.checked
                        ? [...rules.raceSelection, race]
                        : rules.raceSelection.filter((r) => r !== race),
                    })
                  }
                />
                <span style={{ color: RACES[race].color }}>{RACES[race].factionName}</span>
                <small className="muted">{RACES[race].traits[0]}</small>
              </label>
            );
          })}
        </div>

        <h3>種族天賦</h3>
        <p className="muted">
          調整之後新出生的小人，{Object.values(ATTR_LABELS).join('、')}全部乘上倍率。
        </p>
        <div className="rules">
          {RACE_ORDER.map((race) => (
            <label key={race} className="rule">
              <span className="rule-name" style={{ color: RACES[race].color }}>{RACES[race].name}</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={rules.racePower[race]}
                onChange={(e) =>
                  onChange({ ...rules, racePower: { ...rules.racePower, [race]: Number(e.target.value) } })
                }
              />
              <span className="rule-val">×{rules.racePower[race].toFixed(2)}</span>
            </label>
          ))}
        </div>

        <label className="rule-check">
          <input
            type="checkbox"
            checked={rules.infiniteMana}
            onChange={(e) => onChange({ ...rules, infiniteMana: e.target.checked })}
          />
          神力無限（沙盒模式）
        </label>
        <label className="rule-check">
          <input
            type="checkbox"
            checked={rules.allianceVictory}
            onChange={(e) => onChange({ ...rules, allianceVictory: e.target.checked })}
          />
          所有存活陣營結盟時，算「結盟共治」勝利
        </label>
        <label className="rule-check">
          <input
            type="checkbox"
            checked={rules.neutralLairs}
            onChange={(e) => onChange({ ...rules, neutralLairs: e.target.checked })}
          />
          中立巢穴：怪物守護遠古礦脈、神器、秘術與上古圖紙
          <em className="new-game-tag">新局</em>
        </label>

        <div className="modal-actions">
          <button onClick={() => onChange(DEFAULT_RULES)}>恢復預設</button>
          <span className="spacer" />
          {pending && <span className="muted">有新局才生效的變更</span>}
          <button className="primary" onClick={onNewGame}>以這些規則開新局</button>
        </div>
      </div>
    </div>
  );
}
