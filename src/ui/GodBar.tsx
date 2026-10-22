import { MANA_MAX } from '../sim/constants';
import { POWER_DEFS, POWER_ORDER, type PowerId } from '../sim/powers';
import type { World } from '../sim/types';

interface Props {
  world: World;
  selected: PowerId | null;
  onSelect: (id: PowerId | null) => void;
  message: { ok: boolean; text: string } | null;
}

export function GodBar({ world, selected, onSelect, message }: Props) {
  const infinite = world.rules.infiniteMana;
  return (
    <div className="god-bar">
      <div className="mana" title="神力會隨時間回復">
        <span>神力</span>
        <div className="meter mana-meter">
          <div style={{ width: `${(world.mana / MANA_MAX) * 100}%` }} />
        </div>
        <b>{infinite ? '∞' : Math.floor(world.mana)}</b>
      </div>
      <div className="powers">
        {POWER_ORDER.map((id, i) => {
          const def = POWER_DEFS[id];
          const affordable = infinite || world.mana >= def.cost;
          return (
            <button
              key={id}
              className={`power ${selected === id ? 'active' : ''}`}
              disabled={!affordable || world.over}
              onClick={() => onSelect(selected === id ? null : id)}
              title={`${def.desc}（快捷鍵 ${i + 1}）`}
            >
              <span className="power-icon">{def.icon}</span>
              {def.name}
              <small>{def.cost}</small>
            </button>
          );
        })}
      </div>
      <div className={`god-hint ${message && !message.ok ? 'fail' : ''}`}>
        {selected
          ? `${POWER_DEFS[selected].desc}。點地圖施放，右鍵或 Esc 取消`
          : message?.text ?? '選一個神力，再點地圖施放（快捷鍵 1–9）'}
      </div>
    </div>
  );
}
