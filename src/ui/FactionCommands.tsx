import { BUILDING_DEFS, buildingCost } from '../sim/buildings';
import { issueCommand, unitCost } from '../sim/commands';
import { isBuildingUnlocked } from '../sim/systems/building';
import type { BuildingType, Faction, Resources, Role, World } from '../sim/types';
import { RESOURCE_NAMES, ROLE_NAMES, canAfford, popCapOf, popOf } from '../sim/util';

const ROLES: Role[] = ['worker', 'warrior', 'smith'];
const BUILDABLE: BuildingType[] = ['house', 'farm', 'forge', 'library', 'barracks', 'tower'];

const costText = (cost: Partial<Resources>) =>
  (Object.keys(cost) as (keyof Resources)[]).map((k) => `${RESOURCE_NAMES[k]} ${cost[k]}`).join('、');

/** 玩家接管陣營後的指揮面板：透過和 AI 相同的指令佇列下令 */
export function FactionCommands({ world, f }: { world: World; f: Faction }) {
  const enemies = world.factions.filter((e) => e.id !== f.id && e.alive);
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
        {enemies.map((e) => (
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
