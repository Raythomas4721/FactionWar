import { describe, expect, it } from 'vitest';
import { castPower } from '../src/sim/powers';
import { RACES } from '../src/sim/races';
import { diseaseResistOf } from '../src/sim/stats';
import { infect, infectionRisk, updateDisease, updateHunger, upkeepOf } from '../src/sim/systems/health';
import { centerOf, hqOf } from '../src/sim/util';
import { step } from '../src/sim/world';
import { createWorld } from './helpers';

describe('疾病', () => {
  it('體質越高越不容易生病', () => {
    const base = { str: 10, agi: 10, int: 10, con: 10, cha: 10 };
    expect(diseaseResistOf({ ...base, con: 15 })).toBeLessThan(diseaseResistOf({ ...base, con: 6 }));
  });

  it('矮人的染病風險遠低於精靈', () => {
    const w = createWorld(1);
    const avgRisk = (race: string) => {
      const us = w.units.filter((u) => u.race === race);
      return us.reduce((s, u) => s + infectionRisk(w, u), 0) / us.length;
    };
    expect(avgRisk('dwarf')).toBeLessThan(avgRisk('elf') * 0.6);
  });

  it('疫病強度為 0 時完全不會染病', () => {
    const w = createWorld(1, { rules: { diseaseMult: 0 } });
    for (const u of w.units) expect(infectionRisk(w, u)).toBe(0);
  });

  it('病人會傳染給身邊的人', () => {
    const w = createWorld(2, { rules: { diseaseMult: 3 } });
    const [patient, ...others] = w.units.filter((u) => u.factionId === 0);
    for (const o of others) {
      o.x = patient.x + 0.3;
      o.y = patient.y;
    }
    infect(w, patient);
    for (let i = 0; i < 300; i++) updateDisease(w);
    expect(w.factions[0].stats.infections).toBeGreaterThan(1);
  });

  it('康復後一段時間內免疫', () => {
    const w = createWorld(3);
    const u = w.units[0];
    u.immuneUntil = w.tick + 100;
    expect(infect(w, u)).toBe(false);
    u.immuneUntil = 0;
    expect(infect(w, u)).toBe(true);
    expect(infect(w, u)).toBe(false); // 已經在生病
  });

  it('瘟疫神力讓範圍內小人染病，祝福可以治好', () => {
    const w = createWorld(4, { rules: { infiniteMana: true } });
    const human = w.factions.find((f) => f.race === 'human')!;
    const c = centerOf(hqOf(w, human)!);
    castPower(w, 'plague', c.x, c.y);
    const sick = w.units.filter((u) => u.sick);
    expect(sick.length).toBeGreaterThan(0);
    castPower(w, 'bless', c.x, c.y);
    expect(sick.every((u) => !u.sick || Math.hypot(u.x - c.x, u.y - c.y) > 3)).toBe(true);
  });
});

describe('飢餓', () => {
  it('每個人口每 tick 會吃掉糧食，獸人吃得比精靈多', () => {
    const w = createWorld(5);
    const orc = w.factions.find((f) => f.race === 'orc')!;
    const elf = w.factions.find((f) => f.race === 'elf')!;
    expect(upkeepOf(w, orc, 10)).toBeGreaterThan(upkeepOf(w, elf, 10));
    expect(RACES.orc.foodUpkeep).toBeGreaterThan(RACES.elf.foodUpkeep);
  });

  it('沒有糧食時陣營進入飢荒，族人飢餓度上升、最後餓死', () => {
    const w = createWorld(6);
    const f = w.factions[0];
    f.resources.food = 0;
    const units = w.units.filter((u) => u.factionId === f.id);
    const starve = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        f.resources.food = 0;
        updateHunger(w);
      }
    };
    starve(800);
    expect(f.starving).toBe(true);
    expect(units.every((u) => u.hunger === 1)).toBe(true);
    starve(2500);
    expect(f.stats.starved).toBeGreaterThan(0);
  });

  it('糧食消耗為 0 時不會挨餓', () => {
    const w = createWorld(6, { rules: { upkeepMult: 0 } });
    w.factions[0].resources.food = 0;
    for (let i = 0; i < 100; i++) step(w);
    expect(w.factions[0].starving).toBe(false);
  });
});
