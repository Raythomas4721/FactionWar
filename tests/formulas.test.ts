import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '../src/sim/items';
import { RACES } from '../src/sim/races';
import { Rng } from '../src/sim/rng';
import { maxHpOf } from '../src/sim/stats';
import { hitChance, mitigatedDamage } from '../src/sim/systems/combat';
import { expectedQuality, isItemUnlocked, pickCraftDef } from '../src/sim/systems/crafting';
import type { Attributes } from '../src/sim/types';
import { createBlankWorld, createFaction } from '../src/sim/world';

const avg: Attributes = { str: 10, agi: 10, int: 10, con: 10, cha: 10 };

describe('rng', () => {
  it('同一個種子產生同樣的序列', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('不同種子產生不同序列', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe('種族', () => {
  it('矮人體質最高，所以生命值最多', () => {
    const cons = Object.values(RACES).map((r) => r.base.con);
    expect(RACES.dwarf.base.con).toBe(Math.max(...cons));
    expect(maxHpOf(RACES.dwarf.base)).toBeGreaterThan(maxHpOf(RACES.elf.base));
  });

  it('精靈智慧最高、獸人最低', () => {
    expect(RACES.elf.base.int).toBeGreaterThan(RACES.orc.base.int);
    expect(RACES.human.base.cha).toBe(Math.max(...Object.values(RACES).map((r) => r.base.cha)));
  });
});

describe('打造品質', () => {
  const sword = ITEM_DEFS.ironSword;

  it('工匠智慧越高，品質越好', () => {
    const dumb = expectedQuality({ ...avg, int: 5 }, 'orc', 1, true, sword);
    const smart = expectedQuality({ ...avg, int: 16 }, 'orc', 1, true, sword);
    expect(smart).toBeGreaterThan(dumb);
  });

  it('有鍛造坊、科技較高都會提升品質', () => {
    expect(expectedQuality(avg, 'orc', 1, true, sword)).toBeGreaterThan(expectedQuality(avg, 'orc', 1, false, sword));
    expect(expectedQuality(avg, 'orc', 3, true, sword)).toBeGreaterThan(expectedQuality(avg, 'orc', 1, true, sword));
  });

  it('種族專精有加成：矮人打造戰鎚比精靈好', () => {
    const hammer = ITEM_DEFS.warhammer;
    expect(expectedQuality(avg, 'dwarf', 2, true, hammer)).toBeGreaterThan(expectedQuality(avg, 'elf', 2, true, hammer));
  });

  it('科技、鍛造坊、種族限定會鎖住裝備', () => {
    const world = createBlankWorld(1);
    const elves = createFaction(world, 'elf', ['elf', 'dwarf']);
    const dwarves = createFaction(world, 'dwarf', ['elf', 'dwarf']);
    expect(isItemUnlocked(ITEM_DEFS.ironSword, elves, true)).toBe(false); // 科技 0
    elves.tech = 1;
    expect(isItemUnlocked(ITEM_DEFS.ironSword, elves, false)).toBe(false); // 沒有鍛造坊
    expect(isItemUnlocked(ITEM_DEFS.ironSword, elves, true)).toBe(true);
    elves.tech = dwarves.tech = 4;
    expect(isItemUnlocked(ITEM_DEFS.elvenBow, elves, true)).toBe(true);
    expect(isItemUnlocked(ITEM_DEFS.elvenBow, dwarves, true)).toBe(false);
    expect(pickCraftDef(dwarves, true, 'weapon', false)?.id).toBe('runeHammer');
  });
});

describe('戰鬥', () => {
  it('敏捷高的一方命中率較高', () => {
    expect(hitChance({ ...avg, agi: 15 }, avg)).toBeGreaterThan(hitChance(avg, { ...avg, agi: 15 }));
  });

  it('體質與護甲會減少傷害，但至少 1 點', () => {
    expect(mitigatedDamage(10, { ...avg, con: 15 }, 0)).toBeLessThan(mitigatedDamage(10, { ...avg, con: 5 }, 0));
    expect(mitigatedDamage(10, avg, 3)).toBeLessThan(mitigatedDamage(10, avg, 0));
    expect(mitigatedDamage(1, avg, 10)).toBe(1);
  });
});
