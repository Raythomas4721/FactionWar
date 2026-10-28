import { TICKS_PER_SECOND } from '../sim/constants';
import { SKILL_KEYS, SKILL_UNLOCK, skillOf, type SkillSlot } from '../sim/heroes';
import { skillCooldown, useSkill } from '../sim/systems/heroSystem';
import type { Unit, World } from '../sim/types';

const SLOTS: SkillSlot[] = [1, 2, 3];

/** Q／W（Lv3）／E 大招（Lv5）三個技能按鈕 */
export function SkillButtons({ world, u, compact = false }: { world: World; u: Unit; compact?: boolean }) {
  const h = u.hero!;
  return (
    <>
      {SLOTS.map((slot) => {
        const def = skillOf(h.path, slot);
        const locked = h.level < SKILL_UNLOCK[slot];
        const cd = skillCooldown(u, slot);
        const label = locked
          ? `🔒 Lv${SKILL_UNLOCK[slot]}`
          : cd > 0
            ? `${Math.ceil(cd / TICKS_PER_SECOND)}s`
            : SKILL_KEYS[slot];
        return (
          <button
            key={slot}
            className={`skill-btn ${slot === 3 ? 'ult' : ''} ${!locked && cd <= 0 ? 'ready' : ''}`}
            disabled={locked || cd > 0}
            title={`${slot === 3 ? '大招' : slot === 2 ? '第二技能' : '技能'}「${def.name}」：${def.desc}${locked ? `（Lv${SKILL_UNLOCK[slot]} 解鎖）` : ''}`}
            onClick={() => useSkill(world, u, slot)}
          >
            {compact ? '' : `${slot === 3 ? '💥' : '⚡'} ${def.name} `}
            <small>{label}</small>
          </button>
        );
      })}
    </>
  );
}
