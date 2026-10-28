import { describe, expect, it } from 'vitest';
import { clampCamera, screenToTile } from '../src/render/canvasRenderer';
import { damageUnit, strikeUnit } from '../src/sim/systems/combat';
import {
  SQUAD_SIZE, commandHero, followerThink, possess, promote, release, setRally, squadOf,
} from '../src/sim/systems/heroSystem';
import { spawnUnit } from '../src/sim/util';
import { createWorld } from './helpers';

const setup = () => {
  const w = createWorld(1);
  const [a, b] = w.factions.filter((f) => !f.neutral);
  const hero = spawnUnit(w, a, 'warrior')!;
  promote(w, hero, 'berserk');
  return { w, a, b, hero };
};

describe('鏡頭', () => {
  it('放大時畫面中心的點擊對到鏡頭中心，邊緣依倍率換算', () => {
    const w = createWorld(1);
    const cam = { x: 20, y: 15, zoom: 2 };
    expect(screenToTile(w, cam, 0.5, 0.5)).toEqual({ x: 20, y: 15 });
    expect(screenToTile(w, cam, 1, 0.5).x).toBeCloseTo(20 + w.width / 4);
    expect(screenToTile(w, null, 0.25, 0.5)).toEqual({ x: w.width / 4, y: w.height / 2 });
  });

  it('鏡頭不會拍到地圖外', () => {
    const w = createWorld(1);
    const c = clampCamera(w, { x: 0, y: 0, zoom: 2 });
    expect(c.x).toBeCloseTo(w.width / 4);
    expect(c.y).toBeCloseTo(w.height / 4);
  });
});

describe('打擊感', () => {
  it('英雄連續擊殺會出現連斬字樣', () => {
    const { w, b, hero } = setup();
    for (let i = 0; i < 3; i++) {
      const victim = spawnUnit(w, b, 'worker')!;
      damageUnit(w, victim, 9999, hero.factionId, '測試', hero);
      w.tick += 10;
    }
    expect(hero.hero!.streak).toBe(3);
    expect(w.effects.some((e) => e.text === '三連斬')).toBe(true);
  });

  it('附身的英雄受重擊時畫面會震動', () => {
    const { w, b, hero } = setup();
    possess(w, hero);
    const foe = spawnUnit(w, b, 'warrior')!;
    foe.attrs.agi = 20;
    foe.attrs.str = 20;
    hero.attrs.agi = 1;
    hero.hp = hero.maxHp = 1000;
    for (let i = 0; i < 20 && hero.hp === 1000; i++) {
      foe.cooldown = 0;
      strikeUnit(w, foe, hero);
    }
    expect(hero.hp).toBeLessThan(1000);
    expect(w.shake).toBeGreaterThan(0);
    expect(w.effects.some((e) => e.text)).toBe(true); // 英雄受傷跳紅字
  });
});

describe('跟隨我小隊', () => {
  it('附近的戰士加入小隊，上限 10 人，解除附身就解散', () => {
    const { w, a, hero } = setup();
    possess(w, hero);
    for (let i = 0; i < SQUAD_SIZE + 4; i++) {
      const s = spawnUnit(w, a, 'warrior')!;
      s.x = hero.x + 1;
      s.y = hero.y;
    }
    setRally(w, hero, true);
    expect(squadOf(w, hero)).toHaveLength(SQUAD_SIZE);
    release(w);
    expect(squadOf(w, hero)).toHaveLength(0);
  });

  it('小隊成員攻擊英雄的目標', () => {
    const { w, a, b, hero } = setup();
    possess(w, hero);
    const s = spawnUnit(w, a, 'warrior')!;
    s.x = hero.x + 1;
    s.y = hero.y;
    setRally(w, hero, true);
    const foe = spawnUnit(w, b, 'warrior')!;
    foe.x = hero.x + 3;
    foe.y = hero.y;
    commandHero(w, hero, foe.x, foe.y);
    expect(followerThink(w, s)).toBe(true);
    expect(s.action).toEqual({ type: 'attackUnit', targetId: foe.id });
  });

  it('英雄、怪物與召喚物不會被招進小隊', () => {
    const { w, a, hero } = setup();
    possess(w, hero);
    const other = spawnUnit(w, a, 'warrior')!;
    promote(w, other, 'crit');
    other.x = hero.x + 1;
    other.y = hero.y;
    setRally(w, hero, true);
    expect(other.followHero).toBeUndefined();
  });
});
