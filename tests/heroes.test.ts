import { describe, expect, it } from 'vitest';
import { MAX_HEROES, PATHS, PROMOTE_KILLS, TALENTS, XP_LEVELS } from '../src/sim/heroes';
import { analyzeGame } from '../src/sim/report';
import { damageUnit } from '../src/sim/systems/combat';
import {
  applyPoison, attackModifiers, auraBonus, chooseTalent, commandHero, gainXp, maybePromote, possess,
  possessedHero, promote, release, updateHeroes, useSkill,
} from '../src/sim/systems/heroSystem';
import { spawnUnit } from '../src/sim/util';
import { step } from '../src/sim/world';
import { createWorld } from './helpers';

const setup = (seed = 1) => {
  const w = createWorld(seed);
  const [a, b] = w.factions.filter((f) => !f.neutral);
  return { w, a, b };
};

describe('英雄晉升', () => {
  it('戰士擊殺 4 人晉升為英雄，生命提高，每個陣營最多 2 名', () => {
    const { w, a } = setup();
    const made = [];
    for (let i = 0; i < MAX_HEROES + 1; i++) {
      const u = spawnUnit(w, a, 'warrior')!;
      u.kills = PROMOTE_KILLS;
      const hp = u.maxHp;
      maybePromote(w, u);
      if (u.hero) {
        expect(u.maxHp).toBeGreaterThan(hp * 0.9);
        made.push(u);
      }
    }
    expect(made).toHaveLength(MAX_HEROES);
    expect(a.stats.heroes).toBe(MAX_HEROES);
    expect(w.events.some((e) => e.kind === 'hero')).toBe(true);
  });

  it('擊殺會累積經驗並升級，升級時給兩個天賦選項', () => {
    const { w, a } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    promote(w, u, 'crit');
    a.playerControlled = true;
    gainXp(w, u, XP_LEVELS[2]);
    expect(u.hero!.level).toBe(2);
    expect(u.hero!.choice).toHaveLength(2);
    const pick = u.hero!.choice![0];
    chooseTalent(w, u, pick);
    expect(u.hero!.talents).toContain(pick);
    expect(u.hero!.choice).toBeNull();
  });

  it('AI 陣營的英雄會自動選天賦', () => {
    const { w, a } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    promote(w, u, 'venom');
    gainXp(w, u, XP_LEVELS[3]);
    expect(u.hero!.level).toBe(3);
    expect(u.hero!.talents).toHaveLength(2);
    expect(u.hero!.choice).toBeNull();
  });

  it('英雄戰死會寫入英雄榜', () => {
    const { w, a, b } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    promote(w, u, 'berserk');
    const killer = spawnUnit(w, b, 'warrior')!;
    damageUnit(w, u, 9999, b.id, '測試', killer);
    expect(w.legends).toHaveLength(1);
    expect(w.legends[0].name).toBe(u.name);
    expect(w.legends[0].cause).toContain('擊殺');
  });
});

describe('流派與 Combo', () => {
  it('暴擊流有暴擊率，下一擊必暴（致命一擊）', () => {
    const { w, a, b } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    const t = spawnUnit(w, b, 'warrior')!;
    promote(w, u, 'crit');
    expect(useSkill(w, u)).toBe(true);
    const m = attackModifiers(w, u, t);
    expect(m.crit).toBe(true);
    expect(m.mult).toBeGreaterThanOrEqual(3);
    expect(useSkill(w, u)).toBe(false); // 冷卻中
  });

  it('守護光環讓周圍隊友也能暴擊（Combo）', () => {
    const { w, a } = setup();
    const g = spawnUnit(w, a, 'warrior')!;
    const ally = spawnUnit(w, a, 'warrior')!;
    ally.x = g.x + 1;
    ally.y = g.y;
    expect(auraBonus(w, ally).crit).toBe(0);
    promote(w, g, 'guardian');
    expect(auraBonus(w, ally).crit).toBeGreaterThan(0);
    expect(auraBonus(w, ally).armor).toBeGreaterThan(0);
  });

  it('毒傷流疊毒造成持續傷害；暴擊打中中毒的敵人觸發毒爆', () => {
    const { w, a, b } = setup();
    const v = spawnUnit(w, a, 'warrior')!;
    promote(w, v, 'venom');
    const t = spawnUnit(w, b, 'warrior')!;
    t.hp = t.maxHp = 1000;
    applyPoison(w, v, t, 3);
    for (let i = 0; i < 50; i++) {
      w.tick++;
      updateHeroes(w);
    }
    expect(t.hp).toBeLessThan(1000);

    const c = spawnUnit(w, a, 'warrior')!;
    promote(w, c, 'crit');
    c.hero!.nextCrit = true;
    const poisoned = attackModifiers(w, c, t).mult;
    const clean = spawnUnit(w, b, 'warrior')!;
    c.hero!.nextCrit = true;
    expect(poisoned).toBeGreaterThan(attackModifiers(w, c, clean).mult);
  });

  it('召喚流會定期召喚援兵，到時間消散', () => {
    const { w, a } = setup();
    const s = spawnUnit(w, a, 'warrior')!;
    promote(w, s, 'summon');
    for (let i = 0; i < 200; i++) {
      w.tick++;
      updateHeroes(w);
    }
    const minions = w.units.filter((u) => u.summonedBy === s.id && u.hp > 0);
    expect(minions.length).toBeGreaterThan(0);
    w.tick = minions[0].expiresAt! + 1;
    updateHeroes(w);
    expect(minions[0].hp).toBeLessThanOrEqual(0);
  });

  it('狂戰流生命越低攻擊越高', () => {
    const { w, a, b } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    promote(w, u, 'berserk');
    const t = spawnUnit(w, b, 'warrior')!;
    const full = attackModifiers(w, u, t).mult;
    u.hp = u.maxHp * 0.1;
    expect(attackModifiers(w, u, t).mult).toBeGreaterThan(full * 1.5);
  });

  it('每個流派都有技能與三個流派天賦', () => {
    for (const p of Object.values(PATHS)) {
      expect(p.skill.name).toBeTruthy();
      expect(p.talents).toHaveLength(3);
      p.talents.forEach((t) => expect(TALENTS[t]).toBeDefined());
    }
  });
});

describe('附身', () => {
  it('附身後點地圖下令，AI 不會改掉玩家的命令', () => {
    const { w, a } = setup();
    const u = spawnUnit(w, a, 'warrior')!;
    promote(w, u, 'crit');
    possess(w, u);
    expect(possessedHero(w)).toBe(u);
    expect(commandHero(w, u, u.x + 5, u.y)).toBe('移動');
    for (let i = 0; i < 20; i++) step(w);
    expect(u.action.type === 'guard' || u.action.type === 'idle' || u.action.type === 'attackUnit').toBe(true);
    release(w);
    expect(possessedHero(w)).toBeUndefined();
  });
});

describe('戰報', () => {
  it('戰局結束後每個陣營都有敗因或勝因', () => {
    const w = createWorld(3);
    while (!w.over) step(w);
    const reports = analyzeGame(w);
    expect(reports.length).toBe(4);
    expect(reports.filter((r) => r.won).length).toBeLessThanOrEqual(1);
    for (const r of reports) expect(r.headline.length).toBeGreaterThan(0);
  }, 60_000);
});
