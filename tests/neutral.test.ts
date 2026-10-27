import { describe, expect, it } from 'vitest';
import { itemDef } from '../src/sim/items';
import { ARTIFACTS, ELIXIR_BONUS, LEASH } from '../src/sim/lairs';
import { RACES } from '../src/sim/races';
import { damageBuilding } from '../src/sim/systems/combat';
import { findNearestResource } from '../src/sim/systems/economy';
import { infectionRisk } from '../src/sim/systems/health';
import {
  activeLairs, claimLair, grantElixir, guardianThink, guardiansOf, inLairDanger, weakestAttr,
} from '../src/sim/systems/neutral';
import { getBuilding, spawnUnit } from '../src/sim/util';
import { step } from '../src/sim/world';
import { createWorld } from './helpers';

describe('中立巢穴', () => {
  it('四個象限各一座巢穴、中央是巨龍之巢，都有守衛', () => {
    const w = createWorld(1);
    const beast = w.factions.find((f) => f.neutral)!;
    expect(beast).toBeDefined();
    expect(w.lairs).toHaveLength(5);
    expect(w.lairs.filter((l) => l.monster === 'dragon')).toHaveLength(1);
    for (const lair of w.lairs) {
      expect(getBuilding(w, lair.buildingId)?.type).toBe('lair');
      expect(guardiansOf(w, lair).length).toBeGreaterThan(0);
    }
  });

  it('世界法則關閉中立巢穴時就沒有怪物', () => {
    const w = createWorld(1, { rules: { neutralLairs: false } });
    expect(w.lairs).toHaveLength(0);
    expect(w.factions.some((f) => f.neutral)).toBe(false);
  });

  it('神器獨一無二，不會重複出現', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld(seed);
      const names = w.lairs.flatMap((l) =>
        l.treasure.type === 'artifact' ? [l.treasure.item.name] : l.treasure.type === 'hoard' ? [l.treasure.artifact.name] : [],
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('守衛攻擊闖入地盤的人，但不會追離巢穴太遠', () => {
    const w = createWorld(2);
    const lair = w.lairs[0];
    const guard = guardiansOf(w, lair)[0];
    const intruder = spawnUnit(w, w.factions[0], 'warrior')!;
    intruder.x = lair.center.x + 3;
    intruder.y = lair.center.y;
    guardianThink(w, guard);
    expect(guard.action.type).toBe('attackUnit');
    intruder.x = lair.center.x + LEASH + 5;
    guard.x = lair.center.x + LEASH + 3;
    guardianThink(w, guard);
    expect(guard.action.type).toBe('guard');
  });

  it('工人不敢去巢穴旁的礦脈採集', () => {
    const w = createWorld(3);
    const lair = w.lairs[0];
    expect(inLairDanger(w, lair.center.x + 2, lair.center.y)).toBe(true);
    const worker = w.units.find((u) => u.role === 'worker' && !w.factions[u.factionId].neutral)!;
    worker.x = lair.center.x + 1;
    worker.y = lair.center.y + 1;
    const spot = findNearestResource(w, worker, 'ore');
    if (spot) expect(inLairDanger(w, spot.x + 0.5, spot.y + 0.5)).toBe(false);
  });
});

describe('攻陷巢穴與寶藏', () => {
  it('摧毀巢穴的陣營奪得寶藏，殘存守衛潰散', () => {
    const w = createWorld(4);
    const f = w.factions.find((x) => !x.neutral)!;
    const lair = w.lairs[0];
    const b = getBuilding(w, lair.buildingId)!;
    damageBuilding(w, b, 99999, f.id);
    expect(lair.claimedBy).toBe(f.id);
    expect(guardiansOf(w, lair)).toHaveLength(0);
    const t = lair.treasure;
    if (t.type === 'relic') expect(f.relics).toContain(t.relic);
    if (t.type === 'artifact') expect(f.armory.some((i) => itemDef(i).name === t.item.name)).toBe(true);
    if (t.type === 'blueprint') expect(f.blueprints.some((bp) => bp.inventor === '上古工匠')).toBe(true);
    expect(w.events.some((e) => e.kind === 'lair')).toBe(true);
  });

  it('巨龍之巢同時給神器與秘術', () => {
    const w = createWorld(5);
    const f = w.factions.find((x) => !x.neutral)!;
    const dragon = w.lairs.find((l) => l.monster === 'dragon')!;
    claimLair(w, dragon, f.id);
    expect(f.relics.length).toBe(1);
    expect(f.armory.some((i) => ARTIFACTS.some((a) => a.name === itemDef(i).name))).toBe(true);
  });

  it('所有巢穴都被攻陷後，中立陣營消失但不影響勝負判定', () => {
    const w = createWorld(6);
    const f = w.factions.find((x) => !x.neutral)!;
    for (const lair of [...activeLairs(w)]) claimLair(w, lair, f.id);
    expect(w.factions.find((x) => x.neutral)!.alive).toBe(false);
    step(w);
    expect(w.over).toBe(false);
  });
});

describe('賢者秘藥', () => {
  it('補強奪寶陣營最弱的屬性：獸人補智慧，現有族人與之後出生的都有', () => {
    const w = createWorld(8);
    const orc = w.factions.find((x) => x.race === 'orc')!;
    expect(weakestAttr(orc)).toBe('int');
    const someone = w.units.find((u) => u.factionId === orc.id)!;
    const before = someone.attrs.int;
    expect(grantElixir(w, orc)).toBe('int');
    expect(someone.attrs.int).toBe(before + ELIXIR_BONUS);
    expect(orc.attrBonus.int).toBe(ELIXIR_BONUS);
    const newborn = spawnUnit(w, orc, 'smith')!;
    expect(newborn.attrs.int).toBeGreaterThan(RACES.orc.base.int - 4);
  });

  it('補體質時生命上限跟著提高', () => {
    const w = createWorld(8);
    const elf = w.factions.find((x) => x.race === 'elf')!;
    elf.attrBonus = { str: 10, agi: 10, int: 10, con: 0, cha: 10 }; // 讓體質成為最弱
    const u = w.units.find((x) => x.factionId === elf.id)!;
    const maxHp = u.maxHp;
    expect(grantElixir(w, elf)).toBe('con');
    expect(u.maxHp).toBeGreaterThan(maxHp);
  });
});

describe('秘術效果', () => {
  it('生命之泉讓染病風險大降', () => {
    const w = createWorld(7);
    const f = w.factions.find((x) => !x.neutral && x.race !== 'undead')!;
    const u = w.units.find((x) => x.factionId === f.id)!;
    const before = infectionRisk(w, u);
    f.relics.push('vitality');
    expect(infectionRisk(w, u)).toBeCloseTo(before * 0.4);
  });
});
