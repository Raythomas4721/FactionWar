import { issueCommand, unitCost } from '../sim/commands';
import { OUTPOST_DEFS } from '../sim/outposts';
import { MAX_GARRISON, adjustGarrison, garrisonOf } from '../sim/systems/outposts';
import { popCapOf, popOf } from '../sim/util';
import { DIFFICULTIES } from '../sim/kingdom';
import { activeModifiers, attackForbidden } from '../sim/modifiers';
import { POLICIES, choosePolicy, policyBlocked } from '../sim/policies';
import { activeLairs } from '../sim/systems/neutral';
import { ODDS_LABEL, lairOdds } from '../sim/strength';
import { centerOf, hqOf } from '../sim/util';
import { dist } from '../sim/math';
import type { Faction, FocusTactic, Modifier, Outpost, RetreatTactic, Troop, World } from '../sim/types';
import { hasSea } from '../sim/sea';
import { coalitionOf } from '../sim/expansion';
import { TROOP_DEFS, canTrainTroop } from '../sim/troops';
import { canAfford, hasCompleted } from '../sim/util';
import { RACE_ICONS } from './KingdomSetup';
import { formatTime } from './ControlBar';
import {
  ABILITIES, ABILITY_ORDER, FOCUS_LABEL, RETREAT_LABEL, abilityCooldown, musterTarget, useAbility,
} from '../sim/tactics';
import { TICKS_PER_SECOND } from '../sim/constants';

const remaining = (world: World, m: Modifier) => (m.until === Infinity ? '永久' : formatTime(m.until - world.tick));

function ModChips({ world, f, prefix }: { world: World; f: Faction; prefix?: string }) {
  return (
    <>
      {activeModifiers(world, f)
        .filter((m) => m.source !== 'difficulty')
        .map((m, i) => (
          <span key={`${m.source}-${i}`} className="mod-chip" style={{ borderColor: f.color }} title={POLICIES[m.source as keyof typeof POLICIES]?.gain}>
            {prefix}
            {m.icon} {m.name} <small>{remaining(world, m)}</small>
          </span>
        ))}
    </>
  );
}

/** 據點的狀態文字：我方／敵方／中立，或正在佔領的進度 */
export function outpostStatus(o: Outpost, me: Faction): string {
  if (o.capturing !== null && o.progress > 0) {
    return `${o.capturing === me.id ? '佔領' : '被搶'}${Math.round(o.progress * 100)}%`;
  }
  return o.owner === null ? '中立' : o.owner === me.id ? '我方' : '敵方';
}

/** 派兵佔領／加派／撤回（指揮列與檢視面板共用） */
export function OutpostActions({ world, o, me }: { world: World; o: Outpost; me: Faction }) {
  const want = me.garrisons[o.id] ?? 0;
  const have = garrisonOf(world, me.id, o.id).length;
  if (want === 0) {
    return (
      <button className="op-go" data-coach="outpost" title="派 3 名戰士過去佔領並駐守" onClick={() => adjustGarrison(world, me, o.id, 3)}>
        🚩 <span className="long">派兵</span>佔領
      </button>
    );
  }
  return (
    <>
      <span className="garrison-count" title="已抵達／派出的駐守人數">
        <span className="long">🛡</span>
        {have}/{want}
      </span>
      <button aria-label="加派一人" title="加派一人" disabled={want >= MAX_GARRISON} onClick={() => adjustGarrison(world, me, o.id, 1)}>
        ＋
      </button>
      <button aria-label="撤回駐軍" title="撤回駐軍" onClick={() => adjustGarrison(world, me, o.id, -want)}>
        <span className="long">撤回</span>
        <span className="short">✕</span>
      </button>
    </>
  );
}

function OutpostChip({ world, o, me }: { world: World; o: Outpost; me: Faction }) {
  const def = OUTPOST_DEFS[o.kind];
  const owner = o.owner !== null ? world.factions[o.owner] : null;
  return (
    <span
      className="outpost-chip"
      style={{ borderColor: owner?.color }}
      title={`${def.name}（${owner ? owner.name : '中立'}）：${def.desc}`}
    >
      <span className="op-name">
        {def.icon}
        <span className="long">{def.name}</span>
      </span>
      <small className="op-status" style={{ color: owner?.color }}>
        {outpostStatus(o, me)}
      </small>
      <span className="spacer" />
      <OutpostActions world={world} o={o} me={me} />
    </span>
  );
}

/** 戰術：撤退時機、集火目標、集結進攻，與三個有冷卻的戰術指令 */
function TacticsRow({ world, me }: { world: World; me: Faction }) {
  const t = me.tactics;
  const mustering = !!musterTarget(world, me);
  return (
    <div className="kb-row kb-tactics">
      <span className="cmd-label">戰術</span>
      <label title={Object.values(RETREAT_LABEL).map((r) => `${r.icon}${r.name}：${r.desc}`).join('\n')}>
        <span className="long">撤退</span>
        <select value={t.retreat} onChange={(e) => (me.tactics = { ...t, retreat: e.target.value as RetreatTactic })}>
          {Object.entries(RETREAT_LABEL).map(([id, r]) => (
            <option key={id} value={id}>
              {r.icon} {r.name}
            </option>
          ))}
        </select>
      </label>
      <label title={Object.values(FOCUS_LABEL).map((r) => `${r.icon}${r.name}：${r.desc}`).join('\n')}>
        <span className="long">集火</span>
        <select value={t.focus} onChange={(e) => (me.tactics = { ...t, focus: e.target.value as FocusTactic })}>
          {Object.entries(FOCUS_LABEL).map(([id, r]) => (
            <option key={id} value={id}>
              {r.icon} {r.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className={t.muster ? 'active' : ''}
        title="開啟後，下令進攻時大軍會先在前線集結，七成五的人到齊（或等 40 秒）才一起衝"
        onClick={() => (me.tactics = { ...t, muster: !t.muster })}
      >
        🚩 {mustering ? '集結中…' : <>集結<span className="long">進攻</span> {t.muster ? '開' : '關'}</>}
      </button>
      <span className="spacer" />
      {ABILITY_ORDER.map((id) => {
        const a = ABILITIES[id];
        const cd = abilityCooldown(world, me, id);
        return (
          <button key={id} className="ability" disabled={cd > 0} title={`${a.name}：${a.desc}（冷卻 ${a.cooldown} 秒）`} onClick={() => useAbility(world, me, id)}>
            {a.icon}
            <span className="long"> {a.name}</span>
            <span className="short"> {a.short}</span>
            {cd > 0 && <small> {Math.ceil(cd / TICKS_PER_SECOND)}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** 海軍：碼頭狀態、造船、登陸作戰開關（地圖上有海才出現） */
function NavyRow({ world, me }: { world: World; me: Faction }) {
  const dock = world.buildings.find((b) => b.factionId === me.id && b.type === 'dock' && b.hp > 0);
  const count = (t: Troop) => world.units.filter((u) => u.factionId === me.id && u.hp > 0 && u.troop === t).length;
  const plan = me.landing;
  const popFull = popOf(world, me.id) >= popCapOf(world, me.id);
  const shipButton = (troop: Troop, icon: string) => {
    const def = TROOP_DEFS[troop];
    const cost = def.cost ?? {};
    const unlocked = canTrainTroop(me, troop, (t) => hasCompleted(world, me.id, t));
    const why = !dock?.complete ? '要先有完工的碼頭' : !unlocked ? `需要科技 Lv${def.tech}` : popFull ? '人口已滿' : '';
    return (
      <button
        disabled={!!why || !canAfford(me.resources, cost)}
        title={`${def.name}（${costText(cost)}）：${def.desc}${why ? `
⚠ ${why}` : ''}`}
        onClick={() => issueCommand(world, me.id, { type: 'train', role: 'warrior', troop })}
      >
        {icon}
        <span className="long"> {def.name}</span> <small>{count(troop)}</small>
      </button>
    );
  };
  return (
    <div className="kb-row kb-navy">
      <span className="cmd-label">海軍</span>
      <span className="muted kb-dock" title="碼頭由大臣自動蓋在離營帳最近的海邊（科技 Lv1）">
        ⚓ {!dock ? '尚無碼頭' : dock.complete ? '碼頭' : `碼頭建造中 ${Math.round(dock.progress * 100)}%`}
      </span>
      {shipButton('transport', '⛵')}
      {shipButton('warship', '🚢')}
      <button
        className={me.tactics.landing ? 'active' : ''}
        title="開啟後，下令進攻時運兵船會載 6 名戰士渡海，到敵方海岸搶灘（水陸夾擊）"
        onClick={() => (me.tactics = { ...me.tactics, landing: !me.tactics.landing })}
      >
        ⚓ {plan ? (plan.phase === 'board' ? '登船中' : plan.phase === 'sail' ? '渡海中' : '返航中') : <>登陸 {me.tactics.landing ? '開' : '關'}</>}
      </button>
    </div>
  );
}

const costText = (cost: Partial<Record<string, number>>) =>
  Object.entries(cost).map(([k, v]) => `${({ wood: '木', stone: '石', ore: '鐵', food: '糧' } as Record<string, string>)[k]} ${v}`).join('、');

interface BarProps {
  world: World;
  /** 附身英雄時的操作回饋 */
  message: { ok: boolean; text: string } | null;
  onOpenOffer: () => void;
  /** 指定偵察地點模式（點地圖） */
  scoutMode: boolean;
  onScoutMode: (on: boolean) => void;
}

/** 王國模式的國王指揮列：戰略、國策倒數、生效中的國策 */
export function KingdomBar({ world, message, onOpenOffer, scoutMode, onScoutMode }: BarProps) {
  const k = world.kingdom!;
  const me = world.factions[k.player];
  // 第一章只有一個對手；擴張後是兩個新王國（第一章的對手已經滅亡）
  const foes = k.chapter === 2 ? k.rivals.map((id) => world.factions[id]) : [world.factions[k.enemy]];
  const aliveFoes = foes.filter((f) => f.alive);
  const beast = world.factions.find((f) => f.neutral && f.alive);
  const lairs = beast ? activeLairs(world) : [];
  const lairsLeft = lairs.length;
  const odds = lairs.map((l) => ({ lair: l, odds: lairOdds(world, me.id, l) }));
  const best = odds.reduce<(typeof odds)[number] | null>((a, b) => (!a || b.odds.ratio > a.odds.ratio ? b : a), null);
  // 據點照離自家營帳的遠近排列
  const hq = hqOf(world, me);
  const home = hq ? centerOf(hq) : { x: 0, y: 0 };
  const outposts = [...world.outposts].sort((a, b) => dist(home.x, home.y, a.x, a.y) - dist(home.x, home.y, b.x, b.y));
  const locked = attackForbidden(world, me);
  const coalition = coalitionOf(world);
  const scouts = world.units.filter((u) => u.hp > 0 && u.factionId === me.id && u.troop === 'scout').length;
  const scoutCost = unitCost(world, me, 'warrior', 'scout');
  const popFull = popOf(world, me.id) >= popCapOf(world, me.id);
  const stance = (s: 'attack' | 'defend', target: number | null) => issueCommand(world, me.id, { type: 'setStance', stance: s, target });
  const isOn = (s: 'attack' | 'defend', target: number | null) => me.stance === s && (s === 'defend' || me.targetFaction === target);

  return (
    <div className="kingdom-bar">
      <div className="kb-row">
        <span className="kb-title">
          👑 <b style={{ color: me.color }}>{me.name}</b>
          <span className="muted"> vs </span>
          {foes.map((f, i) => (
            <span key={f.id}>
              {i > 0 && <span className="muted">、</span>}
              <b style={{ color: f.color, textDecoration: f.alive ? undefined : 'line-through' }}>{f.name}</b>
            </span>
          ))}
          <span className="badge">{DIFFICULTIES[k.difficulty].name}</span>
          {k.chapter === 2 && <span className="badge">三國鼎立</span>}
        </span>
        <span className="spacer" />
        {k.offer ? (
          <button className="primary pulse" onClick={onOpenOffer}>
            📜 選擇國策
          </button>
        ) : (
          me.alive && (
            <span className="muted kb-next" title="下一張國策">
              📜 <span className="long">下一張國策 </span>
              {formatTime(Math.max(0, k.nextPolicyAt - world.tick))}
            </span>
          )
        )}
      </div>
      {me.alive && !world.over && (
        <div className="kb-row kb-stance">
          <button data-coach="defend" className={isOn('defend', null) ? 'active' : ''} onClick={() => stance('defend', null)}>
            🛡 防守
          </button>
          {beast && lairsLeft > 0 && (
            <button
              className={isOn('attack', beast.id) ? 'active attack' : ''}
              disabled={locked}
              title={`派兵討伐中立巢穴，奪取寶藏。全軍出動的勝算：\n${odds
                .map((o) => `${o.lair.name}：${ODDS_LABEL[o.odds.level].icon}${ODDS_LABEL[o.odds.level].text}（戰力 ${Math.round(o.odds.mine)} vs ${Math.round(o.odds.theirs)}）`)
                .join('\n')}`}
              onClick={() => stance('attack', beast.id)}
            >
              🏆 <span className="long">討伐</span>巢穴 {best && <small>{ODDS_LABEL[best.odds.level].icon}</small>}
            </button>
          )}
          {foes.map((foe) => (
            <button
              key={foe.id}
              data-coach="attack"
              className={isOn('attack', foe.id) ? 'active attack' : ''}
              disabled={locked || !foe.alive}
              title={`進攻${foe.name}`}
              onClick={() => stance('attack', foe.id)}
            >
              ⚔ <span className="long">進攻{foe.name}</span>
              <span className="short">{foes.length > 1 ? RACE_ICONS[foe.race] : '進攻'}</span>
            </button>
          ))}
          <button
            data-coach="scout"
            disabled={popFull || me.resources.food < scoutCost}
            title={popFull ? '人口已滿' : `訓練斥候（糧食 ${scoutCost}）：跑得快、視野廣，自動偵察`}
            onClick={() => issueCommand(world, me.id, { type: 'train', role: 'warrior', troop: 'scout' })}
          >
            🔭 斥候 <small>{scouts}</small>
          </button>
          {world.fog && (
            <button
              className={scoutMode ? 'active' : ''}
              disabled={!scouts}
              title="點地圖指定斥候去偵察的地點"
              onClick={() => onScoutMode(!scoutMode)}
            >
              📍 {scoutMode ? '點地圖' : '偵察'}
            </button>
          )}
        </div>
      )}
      {me.alive && !world.over && <TacticsRow world={world} me={me} />}
      {me.alive && !world.over && hasSea(world) && <NavyRow world={world} me={me} />}
      {me.alive && !world.over && (locked || coalition || activeModifiers(world, me).length > 0 || aliveFoes.some((f) => activeModifiers(world, f).length > 0)) && (
        <div className="kb-row kb-mods">
          {locked && <span className="muted">🏯 堅壁清野中，暫時不能進攻</span>}
          {world.tick < k.peaceUntil && <span className="muted">🕊 新王國休養生息 {formatTime(k.peaceUntil - world.tick)}</span>}
          {coalition && (
            <span className="mod-chip coalition" title="你的軍隊太強，兩國聯手對付你、不再互相攻打；打下其中一國，或你不再是最強的一方時，同盟就會瓦解">
              🤝 {coalition[0].name}與{coalition[1].name}結盟共抗你
            </span>
          )}
          <ModChips world={world} f={me} />
          {aliveFoes.map((f) => (
            <ModChips key={f.id} world={world} f={f} prefix={foes.length > 1 ? `${RACE_ICONS[f.race]} ` : '敵 '} />
          ))}
        </div>
      )}
      {me.alive && !world.over && world.outposts.length > 0 && (
        <div className="kb-row kb-outposts">
          <span className="cmd-label">據點</span>
          {outposts.map((o) => (
            <OutpostChip key={o.id} world={world} o={o} me={me} />
          ))}
        </div>
      )}
      {message && <div className={`god-hint ${message.ok ? '' : 'fail'}`}>{message.text}</div>}
    </div>
  );
}

interface OfferProps {
  world: World;
  onLater: () => void;
}

/** 國策卡：三選一，每張都有代價 */
export function PolicyOffer({ world, onLater }: OfferProps) {
  const k = world.kingdom!;
  const me = world.factions[k.player];
  if (!k.offer) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal panel policy-offer">
        <div className="panel-head">
          <h2>📜 國策</h2>
          <span className="muted">三選一：每張都有好處，也都有代價</span>
        </div>
        <div className="policy-cards">
          {k.offer.map((id) => {
            const def = POLICIES[id];
            const blocked = policyBlocked(world, me, id);
            return (
              <button key={id} className="policy-card" disabled={!!blocked} onClick={() => choosePolicy(world, id)}>
                <span className="policy-icon">{def.icon}</span>
                <b>{def.name}</b>
                <span className="policy-gain">✅ {def.gain}</span>
                <span className="policy-cost">⚠ {def.cost}</span>
                {blocked && <span className="policy-blocked">🔒 {blocked}</span>}
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button onClick={onLater}>稍後再選（遊戲繼續）</button>
          <button onClick={() => choosePolicy(world, null)} title="這一輪不推行國策，4 分鐘後再發新的卡">
            放棄這一輪
          </button>
        </div>
      </div>
    </div>
  );
}
