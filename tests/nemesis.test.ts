import { describe, expect, it } from 'vitest';
import { PATH_ORDER, XP_LEVELS, skillOf } from '../src/sim/heroes';
import { damageUnit } from '../src/sim/systems/combat';
import { applyPoison, gainXp, promote, skillReady, useSkill } from '../src/sim/systems/heroSystem';
import { nemesisOf } from '../src/sim/systems/nemesis';
import { spawnUnit } from '../src/sim/util';
import { createWorld } from './helpers';

const setup = () => {
  const w = createWorld(1);
  const [a, b] = w.factions.filter((f) => !f.neutral);
  return { w, a, b };
};

describe('宿敵系統', () => {
  it('殺死英雄的無名小卒一戰成名，成為對方的宿敵', () => {
    const { w, a, b } = setup();
    const hero = spawnUnit(w, a, 'warrior')!;
    promote(w, hero, 'crit');
    const nobody = spawnUnit(w, b, 'warrior')!;
    damageUnit(w, hero, 9999, b.id, '測試', nobody);
    const n = nemesisOf(w, a.id, nobody.id)!;
    expect(n).toBeDefined();
    expect(n.grudge).toBe(50);
    expect(nobody.hero).toBeDefined(); // 晉升英雄
    expect(w.events.some((e) => e.text.includes('宿敵'))).toBe(true);
  });

  it('宿敵繼續殺我方族人，仇恨會加深', () => {
    const { w, a, b } = setup();
    const hero = spawnUnit(w, a, 'warrior')!;
    promote(w, hero, 'crit');
    const killer = spawnUnit(w, b, 'warrior')!;
    damageUnit(w, hero, 9999, b.id, '測試', killer);
    const peasant = spawnUnit(w, a, 'worker')!;
    damageUnit(w, peasant, 9999, b.id, '測試', killer);
    expect(nemesisOf(w, a.id, killer.id)!.grudge).toBe(52);
  });

  it('親手擊敗宿敵就是復仇：復仇者得到稱號與經驗，宿敵從名單移除', () => {
    const { w, a, b } = setup();
    const fallen = spawnUnit(w, a, 'warrior')!;
    promote(w, fallen, 'crit');
    const villain = spawnUnit(w, b, 'warrior')!;
    damageUnit(w, fallen, 9999, b.id, '測試', villain);
    const avenger = spawnUnit(w, a, 'warrior')!;
    promote(w, avenger, 'berserk');
    const xp = avenger.hero!.xp;
    damageUnit(w, villain, 9999, a.id, '測試', avenger);
    expect(nemesisOf(w, a.id, villain.id)).toBeUndefined();
    expect(avenger.hero!.title).toContain('復仇者');
    expect(avenger.hero!.xp).toBeGreaterThan(xp + 40);
    expect(a.stats.revenges).toBe(1);
    expect(w.events.some((e) => e.text.includes('復仇！'))).toBe(true);
  });

  it('宿敵死於別的原因時也會從名單移除', () => {
    const { w, a, b } = setup();
    const hero = spawnUnit(w, a, 'warrior')!;
    promote(w, hero, 'crit');
    const villain = spawnUnit(w, b, 'warrior')!;
    damageUnit(w, hero, 9999, b.id, '測試', villain);
    damageUnit(w, villain, 9999, -1, '天雷');
    expect(nemesisOf(w, a.id, villain.id)).toBeUndefined();
  });
});

describe('第二技能與大招', () => {
  it('Lv3 解鎖第二技能、Lv5 解鎖大招', () => {
    const { w, a } = setup();
    const h = spawnUnit(w, a, 'warrior')!;
    promote(w, h, 'guardian');
    expect(skillReady(h, 1)).toBe(true);
    expect(skillReady(h, 2)).toBe(false);
    expect(skillReady(h, 3)).toBe(false);
    gainXp(w, h, XP_LEVELS[3]);
    expect(skillReady(h, 2)).toBe(true);
    expect(skillReady(h, 3)).toBe(false);
    gainXp(w, h, XP_LEVELS[5]);
    expect(skillReady(h, 3)).toBe(true);
  });

  it('每個流派都有第二技能與大招', () => {
    for (const p of PATH_ORDER) {
      expect(skillOf(p, 2).name).toBeTruthy();
      expect(skillOf(p, 3).cooldown).toBeGreaterThan(skillOf(p, 1).cooldown);
    }
  });

  const leveled = (path: Parameters<typeof promote>[2]) => {
    const { w, a, b } = setup();
    const h = spawnUnit(w, a, 'warrior')!;
    promote(w, h, path);
    gainXp(w, h, XP_LEVELS[6]);
    return { w, a, b, h };
  };

  it('不死之怒：生命不會低於 1', () => {
    const { w, b, h } = leveled('berserk');
    expect(useSkill(w, h, 3)).toBe(true);
    damageUnit(w, h, 99999, b.id, '測試');
    expect(h.hp).toBe(1);
  });

  it('神聖庇護：光環內隊友受到的傷害減半', () => {
    const { w, a, b, h } = leveled('guardian');
    const ally = spawnUnit(w, a, 'warrior')!;
    ally.x = h.x + 1;
    ally.y = h.y;
    ally.hp = ally.maxHp = 1000;
    useSkill(w, h, 3);
    damageUnit(w, ally, 100, b.id, '測試');
    expect(ally.hp).toBe(950);
  });

  it('萬毒噬心：引爆中毒的敵人', () => {
    const { w, b, h } = leveled('venom');
    const foe = spawnUnit(w, b, 'warrior')!;
    foe.x = h.x + 2;
    foe.y = h.y;
    foe.hp = foe.maxHp = 1000;
    applyPoison(w, h, foe, 3);
    useSkill(w, h, 3);
    expect(foe.hp).toBeLessThan(1000);
    expect(foe.poison).toBeUndefined();
  });

  it('亡者大軍：一次召喚 5 名援兵', () => {
    const { w, h } = leveled('summon');
    useSkill(w, h, 3);
    expect(w.units.filter((u) => u.summonedBy === h.id)).toHaveLength(5);
  });

  it('旋風斬：打中周圍所有敵人', () => {
    const { w, b, h } = leveled('berserk');
    const foes = [0, 1, 2].map((i) => {
      const f = spawnUnit(w, b, 'warrior')!;
      f.x = h.x + (i - 1);
      f.y = h.y + 1;
      f.hp = f.maxHp = 1000;
      return f;
    });
    useSkill(w, h, 2);
    expect(foes.every((f) => f.hp < 1000)).toBe(true);
  });

  it('影襲：瞬移到敵人身旁並準備暴擊', () => {
    const { w, b, h } = leveled('crit');
    const foe = spawnUnit(w, b, 'warrior')!;
    foe.x = h.x + 5;
    foe.y = h.y;
    useSkill(w, h, 2);
    expect(Math.abs(h.x - foe.x)).toBeLessThan(1.5);
    expect(h.hero!.nextCrit).toBe(true);
  });
});
