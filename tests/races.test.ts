import { describe, expect, it } from 'vitest';
import { castPower } from '../src/sim/powers';
import { RACES } from '../src/sim/races';
import { damageUnit, strikeUnit } from '../src/sim/systems/combat';
import { persuadeChance, proposalChance } from '../src/sim/systems/diplomacy';
import { infectionRisk, lifespanOf, updateAging, upkeepOf } from '../src/sim/systems/health';
import { spawnUnit } from '../src/sim/util';
import { createWorld } from './helpers';

const NEW_RACES = { raceSelection: ['undead', 'insect', 'human', 'orc'] as const };
const make = (seed = 1) => createWorld(seed, { rules: { raceSelection: [...NEW_RACES.raceSelection] } });
const factionOf = (w: ReturnType<typeof make>, race: string) => w.factions.find((f) => f.race === race)!;

describe('參戰種族', () => {
  it('依世界法則選出參戰種族，沒指定時從六族中隨機選四', () => {
    expect(make().factions.filter((f) => !f.neutral).map((f) => f.race).sort()).toEqual(['human', 'insect', 'orc', 'undead']);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld(seed, { rules: { raceSelection: [] } });
      const contenders = w.factions.filter((f) => !f.neutral);
      expect(contenders).toHaveLength(4);
      expect(new Set(contenders.map((f) => f.race)).size).toBe(4);
      contenders.forEach((f) => seen.add(f.race));
    }
    expect(seen.size).toBe(6);
  });
});

describe('死靈族', () => {
  it('不吃飯、不生病、不會被策反、不與活人談判', () => {
    const w = make();
    const undead = factionOf(w, 'undead');
    const human = factionOf(w, 'human');
    const u = w.units.find((x) => x.factionId === undead.id)!;
    const envoy = spawnUnit(w, human, 'diplomat')!;
    expect(upkeepOf(w, undead, 10)).toBe(0);
    expect(infectionRisk(w, u)).toBe(0);
    expect(persuadeChance(w, envoy, u)).toBe(0);
    expect(proposalChance(w, human, undead, 'peace', envoy)).toBe(0);
  });

  it('無所畏懼：受傷也不掉士氣', () => {
    const w = make();
    const u = w.units.find((x) => x.race === 'undead')!;
    damageUnit(w, u, 5, -1, '測試');
    expect(u.morale).toBe(70);
  });

  it('招魂：附近有活人死去時會化為骷髏兵', () => {
    const w = make();
    const undead = factionOf(w, 'undead');
    const necro = w.units.find((x) => x.factionId === undead.id)!;
    const saved = RACES.undead.raiseDead;
    RACES.undead.raiseDead = 1;
    try {
      const victim = w.units.find((x) => x.race === 'human')!;
      victim.x = necro.x + 1;
      victim.y = necro.y;
      const before = w.units.filter((x) => x.factionId === undead.id).length;
      damageUnit(w, victim, 9999, necro.factionId, '測試');
      const after = w.units.filter((x) => x.factionId === undead.id);
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)!.name).toContain(victim.name);
    } finally {
      RACES.undead.raiseDead = saved;
    }
  });

  it('祝福會灼傷死靈', () => {
    const w = make();
    w.rules.infiniteMana = true;
    const u = w.units.find((x) => x.race === 'undead')!;
    const hp = u.hp;
    castPower(w, 'bless', u.x, u.y);
    expect(u.hp).toBeLessThan(hp);
  });

  it('烈焰武器對死靈傷害加倍', () => {
    const w = make();
    const human = factionOf(w, 'human');
    const flame = { id: 'bp:f', name: '烈焰劍', slot: 'weapon' as const, ranged: false, dmg: 8, range: 1.3, armor: 0, cost: {}, tech: 0, needsForge: false, affinity: [], traits: ['flame' as const], inventor: 'X' };
    const total = (race: string) => {
      let sum = 0;
      for (let i = 0; i < 200; i++) {
        const a = spawnUnit(w, human, 'warrior')!;
        a.attrs.agi = 20;
        a.weapon = { id: 1, defId: flame.id, quality: 1, maker: 'X', custom: flame };
        const t = spawnUnit(w, factionOf(w, race), 'warrior')!;
        t.attrs = { str: 10, agi: 1, int: 10, con: 10, cha: 10 };
        t.hp = t.maxHp = 1000;
        strikeUnit(w, a, t);
        sum += 1000 - t.hp;
      }
      return sum;
    };
    expect(total('undead')).toBeGreaterThan(total('orc') * 1.6);
  });

  it('食屍鬼攻擊時吸血', () => {
    const w = make();
    const ghoul = spawnUnit(w, factionOf(w, 'undead'), 'warrior', 'ghoul')!;
    ghoul.attrs.agi = 20;
    ghoul.hp = 10;
    const t = spawnUnit(w, factionOf(w, 'human'), 'warrior')!;
    t.attrs.agi = 1;
    for (let i = 0; i < 20 && ghoul.hp <= 10; i++) {
      ghoul.cooldown = 0;
      strikeUnit(w, ghoul, t);
    }
    expect(ghoul.hp).toBeGreaterThan(10);
  });
});

describe('蟲族', () => {
  it('壽命到了會老死', () => {
    const w = make();
    const bug = w.units.find((x) => x.race === 'insect')!;
    const human = w.units.find((x) => x.race === 'human')!;
    expect(Number.isFinite(lifespanOf(bug))).toBe(true);
    expect(lifespanOf(human)).toBe(Infinity);
    w.tick = bug.bornAt + lifespanOf(bug) + 1;
    updateAging(w);
    expect(bug.hp).toBeLessThanOrEqual(0);
    expect(human.hp).toBeGreaterThan(0);
  });

  it('吞噬：殺敵獲得研究點數與糧食', () => {
    const w = make();
    const insect = factionOf(w, 'insect');
    const victim = w.units.find((x) => x.race === 'human')!;
    const research = insect.research;
    const food = insect.resources.food;
    damageUnit(w, victim, 9999, insect.id, '測試');
    expect(insect.research).toBeGreaterThan(research);
    expect(insect.resources.food).toBeGreaterThan(food);
  });

  it('擠在一起容易染疫：蟲族的染病風險比人類高', () => {
    const w = make();
    const avg = (race: string) => {
      const us = w.units.filter((x) => x.race === race);
      return us.reduce((s, x) => s + infectionRisk(w, x), 0) / us.length;
    };
    expect(avg('insect')).toBeGreaterThan(avg('human'));
  });
});
