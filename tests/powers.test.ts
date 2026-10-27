import { describe, expect, it } from 'vitest';
import { issueCommand } from '../src/sim/commands';
import { TECH_THRESHOLDS } from '../src/sim/constants';
import { castPower } from '../src/sim/powers';
import { peaceTicksOf } from '../src/sim/rules';
import { centerOf, hqOf } from '../src/sim/util';
import { step } from '../src/sim/world';
import { createWorld } from './helpers';

describe('上帝之手', () => {
  it('天雷傷害範圍內所有小人並消耗神力', () => {
    const w = createWorld(1);
    w.mana = 100;
    const f = w.factions[0];
    const c = centerOf(hqOf(w, f)!);
    const near = w.units.filter((u) => Math.hypot(u.x - c.x, u.y - c.y) <= 2.5);
    expect(near.length).toBeGreaterThan(0);
    const hpBefore = near.map((u) => u.hp);
    const r = castPower(w, 'lightning', c.x, c.y);
    expect(r.ok).toBe(true);
    expect(w.mana).toBe(70);
    near.forEach((u, i) => expect(u.hp).toBeLessThan(hpBefore[i]));
    expect(hqOf(w, f)!.hp).toBeLessThan(hqOf(w, f)!.maxHp);
    expect(w.events.at(-1)?.kind).toBe('god');
  });

  it('神力不足時無法施放', () => {
    const w = createWorld(1);
    w.mana = 5;
    expect(castPower(w, 'gift', 0, 0).ok).toBe(false);
    expect(w.mana).toBe(5);
  });

  it('神力無限時不扣神力', () => {
    const w = createWorld(1, { rules: { infiniteMana: true } });
    w.mana = 100;
    castPower(w, 'gift', 0, 0);
    expect(w.mana).toBe(100);
  });

  it('恩賜給點擊處最近的陣營資源', () => {
    const w = createWorld(1);
    w.mana = 100;
    const f = w.factions[2];
    const c = centerOf(hqOf(w, f)!);
    const wood = f.resources.wood;
    castPower(w, 'gift', c.x + 1, c.y + 1);
    expect(f.resources.wood).toBeGreaterThan(wood);
  });

  it('援軍在營帳生出 3 名帶武器的戰士', () => {
    const w = createWorld(1);
    w.mana = 100;
    const f = w.factions[1];
    const before = w.units.filter((u) => u.factionId === f.id && u.role === 'warrior').length;
    const c = centerOf(hqOf(w, f)!);
    castPower(w, 'reinforce', c.x, c.y);
    const warriors = w.units.filter((u) => u.factionId === f.id && u.role === 'warrior');
    expect(warriors.length).toBe(before + 3);
    expect(warriors.slice(-3).every((u) => u.weapon)).toBe(true);
  });

  it('造林把草地變成森林', () => {
    const w = createWorld(1);
    w.mana = 100;
    const x = w.width / 2;
    const y = w.height / 2 - 6;
    const before = w.tiles.filter((t) => t.kind === 'forest').length;
    const r = castPower(w, 'forest', x, y);
    if (r.ok) expect(w.tiles.filter((t) => t.kind === 'forest').length).toBeGreaterThan(before);
  });
});

describe('世界法則', () => {
  it('開局科技與資源蘊藏在新局生效', () => {
    const rich = createWorld(4, { rules: { resourceRichness: 2, startTech: 2 } });
    const normal = createWorld(4);
    expect(rich.factions.every((f) => f.tech === 2 && f.research === TECH_THRESHOLDS[2])).toBe(true);
    const sum = (w: typeof rich) => w.tiles.reduce((s, t) => s + t.amount, 0);
    expect(sum(rich)).toBeCloseTo(sum(normal) * 2, -2);
  });

  it('休戰期內 AI 不會進攻其他陣營（但可以討伐中立巢穴）', () => {
    const w = createWorld(2, { rules: { peaceMinutes: 3 } });
    const end = peaceTicksOf(w.rules);
    while (w.tick < end - 1) {
      step(w);
      expect(
        w.factions.every((f) => f.neutral || f.stance === 'defend' || (f.targetFaction !== null && w.factions[f.targetFaction].neutral)),
      ).toBe(true);
    }
  });

  it('種族天賦倍率影響新生小人的屬性', () => {
    const strong = createWorld(9, { rules: { racePower: { orc: 1.5, elf: 1, dwarf: 1, human: 1, undead: 1, insect: 1, beast: 1 } } });
    const normal = createWorld(9);
    const strOf = (w: typeof strong) =>
      w.units.filter((u) => u.race === 'orc').reduce((s, u) => s + u.attrs.str, 0);
    expect(strOf(strong)).toBeGreaterThan(strOf(normal));
  });
});

describe('玩家指揮', () => {
  it('接管後 AI 不再改變戰略，玩家的進攻命令會生效', () => {
    const w = createWorld(3, { rules: { peaceMinutes: 0 } });
    const f = w.factions[0];
    f.playerControlled = true;
    issueCommand(w, f.id, { type: 'setStance', stance: 'attack', target: 1 });
    for (let i = 0; i < 400; i++) step(w);
    expect(f.stance).toBe('attack');
    expect(f.targetFaction).toBe(1);
    issueCommand(w, f.id, { type: 'setStance', stance: 'defend', target: null });
    for (let i = 0; i < 400; i++) step(w);
    expect(f.stance).toBe('defend');
  });
});
