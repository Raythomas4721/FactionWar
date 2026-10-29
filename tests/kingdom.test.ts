import { describe, expect, it } from 'vitest';
import { issueCommand, processCommands, unitCost } from '../src/sim/commands';
import { createKingdomWorld, kingdomOutcome, resolveEnemy } from '../src/sim/kingdom';
import { DUEL_H, DUEL_W, generateDuelMap } from '../src/sim/map';
import { modOf } from '../src/sim/modifiers';
import {
  FIRST_POLICY_AT, POLICIES, POLICY_INTERVAL, choosePolicy, drawPolicies, enactPolicy, updateKingdom,
} from '../src/sim/policies';
import { castPower } from '../src/sim/powers';
import { RACE_ORDER } from '../src/sim/races';
import { Rng } from '../src/sim/rng';
import { eliminateFaction } from '../src/sim/systems/combat';
import { canPossess, choosePath, promote } from '../src/sim/systems/heroSystem';
import { factionUnits, spawnUnit } from '../src/sim/util';
import { step } from '../src/sim/world';

const kingdom = (seed = 1, difficulty: 'easy' | 'normal' | 'hard' = 'normal') =>
  createKingdomWorld({ player: 'human', enemy: 'orc', difficulty, seed });

describe('1v1 對峙地圖', () => {
  it('兩個營帳、各一座巢穴，地形點對稱', () => {
    const map = generateDuelMap(new Rng(7));
    expect(map.hqSpots).toHaveLength(2);
    expect(map.lairSpots).toHaveLength(2);
    for (let y = 0; y < DUEL_H; y++) {
      for (let x = 0; x < DUEL_W; x++) {
        const a = map.tiles[y * DUEL_W + x];
        const b = map.tiles[(DUEL_H - 1 - y) * DUEL_W + (DUEL_W - 1 - x)];
        expect(a.kind).toBe(b.kind);
      }
    }
    const [p, q] = map.hqSpots;
    expect(q).toEqual({ x: DUEL_W - 2 - p.x, y: DUEL_H - 2 - p.y });
  });

  it('對稱的巢穴守衛相同', () => {
    const w = kingdom(3);
    const lairs = w.lairs.filter((l) => l.monster !== 'dragon');
    expect(lairs).toHaveLength(2);
    expect(lairs[0].monster).toBe(lairs[1].monster);
    expect(lairs[0].treasure.type).toBe(lairs[1].treasure.type);
  });
});

describe('王國模式開局', () => {
  it('玩家與對手各一個陣營，加上中立怪物', () => {
    const w = kingdom();
    const contenders = w.factions.filter((f) => !f.neutral);
    expect(contenders.map((f) => f.race)).toEqual(['human', 'orc']);
    expect(w.factions[w.kingdom!.player].playerControlled).toBe(true);
    expect(w.factions[w.kingdom!.enemy].playerControlled).toBe(false);
    expect(w.rules.allianceVictory).toBe(false);
  });

  it('隨機對手不會和玩家同族', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const player of RACE_ORDER) {
        expect(resolveEnemy({ player, enemy: 'random', difficulty: 'normal', seed })).not.toBe(player);
      }
    }
  });

  it('困難難度的敵人採集更快、更積極，簡單相反', () => {
    const hard = kingdom(1, 'hard');
    const easy = kingdom(1, 'easy');
    const he = hard.factions[hard.kingdom!.enemy];
    const ee = easy.factions[easy.kingdom!.enemy];
    expect(modOf(hard, he.id, 'gather')).toBeGreaterThan(1);
    expect(modOf(easy, ee.id, 'gather')).toBeLessThan(1);
    expect(he.aggression).toBeGreaterThan(ee.aggression);
    expect(he.counterPlay).toBe(true);
    expect(modOf(hard, hard.kingdom!.player, 'gather')).toBe(1);
  });

  it('不能用神力，也不能附身敵方英雄', () => {
    const w = kingdom();
    expect(castPower(w, 'lightning', 10, 10).ok).toBe(false);
    const foe = factionUnits(w, w.kingdom!.enemy).find((u) => u.role === 'warrior')!;
    const mine = factionUnits(w, w.kingdom!.player).find((u) => u.role === 'warrior')!;
    promote(w, foe, choosePath(w, foe));
    promote(w, mine, choosePath(w, mine));
    expect(canPossess(w, foe)).toBe(false);
    expect(canPossess(w, mine)).toBe(true);
  });

  it('攻陷對方就勝利，被攻陷就戰敗', () => {
    const w = kingdom();
    eliminateFaction(w, w.factions[w.kingdom!.enemy], w.factions[w.kingdom!.player]);
    step(w);
    expect(kingdomOutcome(w)).toBe('won');

    const l = kingdom(2);
    eliminateFaction(l, l.factions[l.kingdom!.player], l.factions[l.kingdom!.enemy]);
    step(l);
    expect(kingdomOutcome(l)).toBe('lost');
  });
});

describe('國策卡', () => {
  it('時間到就發三張不重複的卡，選完才開始下一輪計時', () => {
    const w = kingdom();
    w.tick = FIRST_POLICY_AT;
    updateKingdom(w);
    const offer = w.kingdom!.offer!;
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    expect(choosePolicy(w, null)).toBe(true);
    expect(w.kingdom!.offer).toBeNull();
    expect(w.kingdom!.nextPolicyAt).toBe(w.tick + POLICY_INTERVAL);
  });

  it('全民皆兵：立刻多 5 名戰士，採集變慢，到期後恢復', () => {
    const w = kingdom();
    const me = w.factions[w.kingdom!.player];
    const before = factionUnits(w, me.id).filter((u) => u.role === 'warrior').length;
    enactPolicy(w, me, 'levy');
    expect(factionUnits(w, me.id).filter((u) => u.role === 'warrior').length).toBe(before + 5);
    expect(modOf(w, me.id, 'gather')).toBeCloseTo(0.7);
    w.tick += 4 * 600;
    expect(modOf(w, me.id, 'gather')).toBe(1);
  });

  it('堅壁清野期間不能下令進攻', () => {
    const w = kingdom();
    const me = w.factions[w.kingdom!.player];
    enactPolicy(w, me, 'fortify');
    processCommands(w, me);
    issueCommand(w, me.id, { type: 'setStance', stance: 'attack', target: w.kingdom!.enemy });
    processCommands(w, me);
    expect(me.stance).toBe('defend');
    expect(modOf(w, me.id, 'tower')).toBeCloseTo(1.6);
  });

  it('蟲海戰術讓訓練變便宜', () => {
    const w = kingdom();
    const me = w.factions[w.kingdom!.player];
    const cost = unitCost(w, me, 'warrior');
    enactPolicy(w, me, 'swarm');
    expect(unitCost(w, me, 'warrior')).toBeLessThan(cost);
  });

  it('招安讓敵方戰士倒戈；對手無法被策反時抽不到', () => {
    const w = kingdom();
    const me = w.factions[w.kingdom!.player];
    const foe = w.factions[w.kingdom!.enemy];
    for (let i = 0; i < 4; i++) spawnUnit(w, foe, 'warrior');
    const before = factionUnits(w, me.id).length;
    me.resources.food = 200;
    enactPolicy(w, me, 'amnesty');
    // 人類招安 5 名
    expect(factionUnits(w, me.id).length).toBe(before + 5);

    const undead = createKingdomWorld({ player: 'human', enemy: 'undead', difficulty: 'normal', seed: 1 });
    const p = undead.factions[undead.kingdom!.player];
    for (let i = 0; i < 40; i++) expect(drawPolicies(undead, p)).not.toContain('amnesty');
  });

  it('資源不夠時不能推行', () => {
    const w = kingdom();
    const me = w.factions[w.kingdom!.player];
    me.resources = { wood: 0, stone: 0, ore: 0, food: 0 };
    expect(POLICIES.mercs.blocked!(w, me)).not.toBeNull();
    expect(enactPolicy(w, me, 'mercs')).toBe(false);
  });

  it('普通難度的敵人會推行國策，簡單不會', () => {
    for (const [difficulty, expected] of [['normal', true], ['easy', false]] as const) {
      const w = kingdom(5, difficulty);
      w.tick = FIRST_POLICY_AT + 400;
      updateKingdom(w);
      expect(w.kingdom!.history.some((h) => h.factionId === w.kingdom!.enemy)).toBe(expected);
    }
  });
});
