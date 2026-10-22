import type { Selection } from '../render/canvasRenderer';
import { BUILDING_DEFS } from '../sim/buildings';
import { ITEM_DEFS, itemSummary } from '../sim/items';
import { ATTR_KEYS, ATTR_LABELS, RACES } from '../sim/races';
import { carryOf, cooldownOf, speedOf } from '../sim/stats';
import { armorOf, hitChance, rawDamage } from '../sim/systems/combat';
import { expectedQuality } from '../sim/systems/crafting';
import { TICKS_PER_SECOND } from '../sim/constants';
import type { Building, Unit, World } from '../sim/types';
import { RESOURCE_NAMES, ROLE_NAMES, getBuilding, hasCompleted } from '../sim/util';
import { formatTime } from './ControlBar';
import { infectionRisk } from '../sim/systems/health';

const ATTR_HINTS: Record<string, string> = {
  str: '近戰傷害、採集量、建造速度',
  agi: '命中、攻速、移動、遠程傷害',
  int: '打造品質、研究速度',
  con: '生命值、減傷、抗病、康復速度',
  cha: '士氣穩定（M4：遊說／策反）',
};

export function Inspector({ world, selection }: { world: World; selection: Selection | null }) {
  let body: JSX.Element;
  if (!selection) {
    body = <p className="muted">點擊地圖上的小人或建築，查看屬性與狀態。</p>;
  } else if (selection.kind === 'unit') {
    const u = world.unitMap.get(selection.id);
    body = u && u.hp > 0 ? <UnitView world={world} u={u} /> : <p className="muted">這名小人已經陣亡了。</p>;
  } else {
    const b = getBuilding(world, selection.id);
    body = b ? <BuildingView world={world} b={b} /> : <p className="muted">這棟建築已被摧毀。</p>;
  }
  return (
    <section className="panel inspector">
      <div className="panel-head">
        <h2>檢視</h2>
      </div>
      {body}
    </section>
  );
}

function describeAction(world: World, u: Unit): string {
  const a = u.action;
  switch (a.type) {
    case 'idle': return '發呆';
    case 'gather': return `採集${RESOURCE_NAMES[a.kind]}`;
    case 'deliver': return u.carrying ? `運送${RESOURCE_NAMES[u.carrying.kind]}回營帳` : '回營帳';
    case 'build': {
      const b = getBuilding(world, a.buildingId);
      return b ? `建造${BUILDING_DEFS[b.type].name}（${Math.round(b.progress * 100)}%）` : '建造中';
    }
    case 'craft': return `打造${ITEM_DEFS[a.defId].name}（${Math.round((a.progress / a.work) * 100)}%）`;
    case 'attackUnit': {
      const t = world.unitMap.get(a.targetId);
      return t ? `攻擊 ${RACES[t.race].name} ${t.name}` : '攻擊';
    }
    case 'attackBuilding': {
      const b = getBuilding(world, a.targetId);
      return b ? `攻打${world.factions[b.factionId].name}的${BUILDING_DEFS[b.type].name}` : '攻城';
    }
    case 'equip': return '回營帳換裝備';
    case 'guard': return '站崗';
    case 'retreat': return u.sick ? '養病' : '撤退休養';
  }
}

function UnitView({ world, u }: { world: World; u: Unit }) {
  const f = world.factions[u.factionId];
  const avgFoe = { str: 10, agi: 10, int: 10, con: 10, cha: 10 };
  const smithQuality =
    u.role === 'smith'
      ? expectedQuality(u.attrs, u.race, f.tech, hasCompleted(world, f.id, 'forge'), ITEM_DEFS.club)
      : null;
  return (
    <div className="unit-view">
      <div className="iv-title">
        <span className="dot" style={{ background: f.color }} />
        <b>{u.name}</b>
        <span className="muted">#{u.id} · {RACES[u.race].name}{ROLE_NAMES[u.role]} · {f.name}</span>
      </div>
      <div className="iv-status">
        <span>❤ {Math.ceil(u.hp)}/{u.maxHp}</span>
        <span>士氣 {Math.round(u.morale)}</span>
        <span>擊殺 {u.kills}</span>
        <span className="muted">出生 {formatTime(u.bornAt)}</span>
      </div>
      <div className="iv-doing">正在：{describeAction(world, u)}</div>
      <div className="iv-status">
        <span className={u.sick ? 'sick-badge' : ''}>{u.sick ? '☣ 患病中（工作減半）' : world.tick < u.immuneUntil ? '🛡 剛康復，暫時免疫' : '健康'}</span>
        <span>染病風險 ×{infectionRisk(world, u).toFixed(2)}</span>
        <span className={u.hunger > 0.4 ? 'starve-badge' : 'muted'}>飢餓 {Math.round(u.hunger * 100)}%</span>
      </div>

      <div className="attrs">
        {ATTR_KEYS.map((k) => {
          const diff = u.attrs[k] - RACES[u.race].base[k];
          return (
            <div key={k} className="attr" title={ATTR_HINTS[k]}>
              <span className="attr-name">{ATTR_LABELS[k]}</span>
              <div className="meter">
                <div style={{ width: `${(u.attrs[k] / 20) * 100}%`, background: f.color }} />
              </div>
              <span className="attr-val">
                {u.attrs[k]}
                {diff !== 0 && <small className={diff > 0 ? 'up' : 'down'}>{diff > 0 ? `+${diff}` : diff}</small>}
              </span>
              <span className="attr-hint">{ATTR_HINTS[k]}</span>
            </div>
          );
        })}
      </div>

      <div className="iv-gear">
        <div>武器：{u.weapon ? itemSummary(u.weapon) : '赤手空拳'}</div>
        <div>護甲：{u.armor ? itemSummary(u.armor) : '無'}</div>
        {u.weapon && <div className="muted">由 {u.weapon.maker} 打造</div>}
      </div>

      <div className="iv-derived muted">
        <span>每擊約 {rawDamage(u).toFixed(1)}</span>
        <span>攻速 {(TICKS_PER_SECOND / cooldownOf(u.attrs)).toFixed(2)}/秒</span>
        <span>命中（對一般敵人）{Math.round(hitChance(u.attrs, avgFoe) * 100)}%</span>
        <span>減傷 {(armorOf(u) + u.attrs.con * 0.2).toFixed(1)}</span>
        <span>移速 {(speedOf(u.attrs) * TICKS_PER_SECOND).toFixed(1)} 格/秒</span>
        {u.role !== 'warrior' && <span>背包 {carryOf(u.attrs)}</span>}
        {smithQuality !== null && <span>打造品質預估 ×{smithQuality.toFixed(2)}</span>}
      </div>
    </div>
  );
}

function BuildingView({ world, b }: { world: World; b: Building }) {
  const f = world.factions[b.factionId];
  const def = BUILDING_DEFS[b.type];
  return (
    <div className="unit-view">
      <div className="iv-title">
        <span className="dot" style={{ background: f.color }} />
        <b>{def.name}</b>
        <span className="muted">{f.name}</span>
      </div>
      <div className="iv-status">
        <span>❤ {Math.ceil(b.hp)}/{b.maxHp}</span>
        <span>{b.complete ? '已完工' : `建造中 ${Math.round(b.progress * 100)}%`}</span>
      </div>
      <p>{def.desc}</p>
      {b.type === 'hq' && (
        <div className="iv-gear">
          <div>軍械庫（{f.armory.length}）</div>
          <ul className="armory">
            {f.armory.slice(0, 8).map((i) => (
              <li key={i.id}>{itemSummary(i)}</li>
            ))}
          </ul>
          {f.craftQueue.length > 0 && (
            <div className="muted">待打造：{f.craftQueue.map((id) => ITEM_DEFS[id].name).join('、')}</div>
          )}
        </div>
      )}
    </div>
  );
}
