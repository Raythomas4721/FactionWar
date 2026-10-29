import { issueCommand } from '../sim/commands';
import { DIFFICULTIES } from '../sim/kingdom';
import { activeModifiers, attackForbidden } from '../sim/modifiers';
import { POLICIES, choosePolicy, policyBlocked } from '../sim/policies';
import { activeLairs } from '../sim/systems/neutral';
import type { Faction, Modifier, World } from '../sim/types';
import { formatTime } from './ControlBar';

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

interface BarProps {
  world: World;
  /** 附身英雄時的操作回饋 */
  message: { ok: boolean; text: string } | null;
  onOpenOffer: () => void;
}

/** 王國模式的國王指揮列：戰略、國策倒數、生效中的國策 */
export function KingdomBar({ world, message, onOpenOffer }: BarProps) {
  const k = world.kingdom!;
  const me = world.factions[k.player];
  const foe = world.factions[k.enemy];
  const beast = world.factions.find((f) => f.neutral && f.alive);
  const lairsLeft = beast ? activeLairs(world).length : 0;
  const locked = attackForbidden(world, me);
  const stance = (s: 'attack' | 'defend', target: number | null) => issueCommand(world, me.id, { type: 'setStance', stance: s, target });
  const isOn = (s: 'attack' | 'defend', target: number | null) => me.stance === s && (s === 'defend' || me.targetFaction === target);

  return (
    <div className="kingdom-bar">
      <div className="kb-row">
        <span className="kb-title">
          👑 <b style={{ color: me.color }}>{me.name}</b>
          <span className="muted"> vs </span>
          <b style={{ color: foe.color }}>{foe.name}</b>
          <span className="badge">{DIFFICULTIES[k.difficulty].name}</span>
        </span>
        <span className="spacer" />
        {k.offer ? (
          <button className="primary pulse" onClick={onOpenOffer}>
            📜 選擇國策
          </button>
        ) : (
          me.alive && <span className="muted kb-next">📜 下一張國策 {formatTime(Math.max(0, k.nextPolicyAt - world.tick))}</span>
        )}
      </div>
      {me.alive && !world.over && (
        <div className="kb-row kb-stance">
          <button className={isOn('defend', null) ? 'active' : ''} onClick={() => stance('defend', null)}>
            🛡 防守
          </button>
          {beast && lairsLeft > 0 && (
            <button
              className={isOn('attack', beast.id) ? 'active attack' : ''}
              disabled={locked}
              title="派兵討伐中立巢穴，奪取寶藏"
              onClick={() => stance('attack', beast.id)}
            >
              🏆 討伐巢穴 <small>({lairsLeft})</small>
            </button>
          )}
          <button
            className={isOn('attack', foe.id) ? 'active attack' : ''}
            disabled={locked || !foe.alive}
            onClick={() => stance('attack', foe.id)}
          >
            ⚔ 進攻{foe.name}
          </button>
          {locked && <span className="muted">🏯 堅壁清野中，暫時不能進攻</span>}
          <ModChips world={world} f={me} />
          <ModChips world={world} f={foe} prefix="敵 " />
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
