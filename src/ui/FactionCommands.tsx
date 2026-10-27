import { BUILDING_DEFS, buildingCost } from '../sim/buildings';
import { issueCommand, unitCost } from '../sim/commands';
import { isBuildingUnlocked } from '../sim/systems/building';
import { TREATY_ICONS, getTreaty } from '../sim/systems/treaties';
import { TROOP_DEFS, TROOP_ORDER, canTrainTroop, isTroopAvailableToRace, troopName } from '../sim/troops';
import type { BuildingType, Faction, Resources, Role, World } from '../sim/types';
import { RESOURCE_NAMES, ROLE_NAMES, canAfford, hasCompleted, popCapOf, popOf } from '../sim/util';

const ROLES: Role[] = ['worker', 'warrior', 'smith', 'diplomat'];
const BUILDABLE: BuildingType[] = ['house', 'farm', 'forge', 'library', 'barracks', 'infirmary', 'stable', 'tower'];

const costText = (cost: Partial<Resources>) =>
  (Object.keys(cost) as (keyof Resources)[]).map((k) => `${RESOURCE_NAMES[k]} ${cost[k]}`).join('、');

/** 玩家接管陣營後的指揮面板：透過和 AI 相同的指令佇列下令 */
export function FactionCommands({ world, f }: { world: World; f: Faction }) {
  const others = world.factions.filter((e) => e.id !== f.id && e.alive && !e.neutral);
  const beast = world.factions.find((e) => e.neutral && e.alive);
  const popFull = popOf(world, f.id) >= popCapOf(world, f.id);

  return (
    <div className="commands">
      <div className="cmd-row">
        <span className="cmd-label">戰略</span>
        <button
          className={f.stance === 'defend' ? 'active' : ''}
          onClick={() => issueCommand(world, f.id, { type: 'setStance', stance: 'defend', target: null })}
        >
          🛡 防守
        </button>
        {beast && (
          <button
            className={f.stance === 'attack' && f.targetFaction === beast.id ? 'active attack' : ''}
            title="派兵討伐中立怪物的巢穴，奪取寶藏"
            onClick={() => issueCommand(world, f.id, { type: 'setStance', stance: 'attack', target: beast.id })}
          >
            🏆 討伐巢穴
          </button>
        )}
        {others.map((e) => (
          <button
            key={e.id}
            className={f.stance === 'attack' && f.targetFaction === e.id ? 'active attack' : ''}
            style={{ color: e.color }}
            onClick={() => issueCommand(world, f.id, { type: 'setStance', stance: 'attack', target: e.id })}
          >
            ⚔ {e.name.slice(0, 2)}
          </button>
        ))}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">外交</span>
        {others.map((o) => {
          const t = getTreaty(world, f.id, o.id);
          return (
            <span key={o.id} className="dip-group" style={{ borderColor: o.color }}>
              <span style={{ color: o.color }}>{TREATY_ICONS[t]} {o.name.slice(0, 2)}</span>
              {t === 'war' && (
                <button onClick={() => issueCommand(world, f.id, { type: 'propose', target: o.id, proposal: 'peace' })}>求和</button>
              )}
              {t === 'peace' && (
                <button onClick={() => issueCommand(world, f.id, { type: 'propose', target: o.id, proposal: 'alliance' })}>結盟</button>
              )}
              {t !== 'war' && (
                <button onClick={() => issueCommand(world, f.id, { type: 'declareWar', target: o.id })}>宣戰</button>
              )}
            </span>
          );
        })}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">訓練</span>
        {ROLES.map((role) => {
          const cost = unitCost(world, f, role);
          return (
            <button
              key={role}
              disabled={popFull || f.resources.food < cost}
              title={popFull ? '人口已滿，請先蓋房屋' : `糧食 ${cost}`}
              onClick={() => issueCommand(world, f.id, { type: 'train', role })}
            >
              {ROLE_NAMES[role]}
            </button>
          );
        })}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">兵種</span>
        {TROOP_ORDER.filter((t) => t !== 'soldier' && isTroopAvailableToRace(t, f.race)).map((troop) => {
          const def = TROOP_DEFS[troop];
          const cost = unitCost(world, f, 'warrior', troop);
          const unlocked = canTrainTroop(f, troop, (t) => hasCompleted(world, f.id, t));
          const need = [def.tech > f.tech ? `科技 Lv${def.tech}` : '', def.needs && !hasCompleted(world, f.id, def.needs) ? BUILDING_DEFS[def.needs].name : '']
            .filter(Boolean)
            .join('、');
          return (
            <button
              key={troop}
              disabled={!unlocked || popFull || f.resources.food < cost}
              title={unlocked ? `糧食 ${cost}｜${def.desc}` : `需要 ${need}｜${def.desc}`}
              onClick={() => issueCommand(world, f.id, { type: 'train', role: 'warrior', troop })}
            >
              {troopName(troop, f.race)}
            </button>
          );
        })}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">建造</span>
        {BUILDABLE.map((type) => {
          const cost = buildingCost(type, f.race);
          const unlocked = isBuildingUnlocked(f, type);
          return (
            <button
              key={type}
              disabled={!unlocked || !canAfford(f.resources, cost)}
              title={unlocked ? `${costText(cost)}｜${BUILDING_DEFS[type].desc}` : `需要科技 Lv${BUILDING_DEFS[type].tech}`}
              onClick={() => issueCommand(world, f.id, { type: 'build', building: type })}
            >
              {BUILDING_DEFS[type].name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
