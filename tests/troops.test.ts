import { describe, expect, it } from 'vitest';
import { issueCommand } from '../src/sim/commands';
import { speedOf } from '../src/sim/stats';
import { strikeBuilding, troopMultiplier } from '../src/sim/systems/combat';
import { moveTo } from '../src/sim/systems/movement';
import { tunnelTick, updateStealth } from '../src/sim/systems/troopActions';
import { createBuilding } from '../src/sim/systems/building';
import { CHARGE_DISTANCE, REVEAL_RADIUS, canTrainTroop } from '../src/sim/troops';
import { hqOf, isTargetable, nearestEnemyUnit, spawnUnit } from '../src/sim/util';
import { createWorld, step } from '../src/sim/world';

const factionOf = (w: ReturnType<typeof createWorld>, race: string) => w.factions.find((f) => f.race === race)!;

describe('兵種解鎖', () => {
  it('騎兵只有人類與獸人能練，而且要科技 2 與馬廄', () => {
    const w = createWorld(1);
    const human = factionOf(w, 'human');
    const elf = factionOf(w, 'elf');
    const has = (built: boolean) => () => built;
    human.tech = elf.tech = 2;
    expect(canTrainTroop(human, 'cavalry', has(false))).toBe(false);
    expect(canTrainTroop(human, 'cavalry', has(true))).toBe(true);
    expect(canTrainTroop(elf, 'cavalry', has(true))).toBe(false);
    expect(canTrainTroop(elf, 'ranger', has(false))).toBe(true);
    expect(canTrainTroop(factionOf(w, 'dwarf'), 'sapper', has(false))).toBe(false); // 科技 0
  });

  it('訓練指令可以指定兵種，不符條件的會被拒絕', () => {
    const w = createWorld(2);
    const elf = factionOf(w, 'elf');
    elf.nextAiAt = Infinity;
    elf.tech = 1;
    elf.resources.food = 500;
    issueCommand(w, elf.id, { type: 'train', role: 'warrior', troop: 'ranger' });
    issueCommand(w, elf.id, { type: 'train', role: 'warrior', troop: 'cavalry' });
    step(w);
    const troops = w.units.filter((u) => u.factionId === elf.id).map((u) => u.troop);
    expect(troops).toContain('ranger');
    expect(troops).not.toContain('cavalry');
  });
});

describe('兵種相剋', () => {
  it('騎兵跑得比步兵快，奔跑夠遠就能衝鋒', () => {
    const w = createWorld(3);
    const human = factionOf(w, 'human');
    const knight = spawnUnit(w, human, 'warrior', 'cavalry')!;
    const foot = spawnUnit(w, human, 'warrior', 'soldier')!;
    foot.attrs = { ...knight.attrs };
    const hq = hqOf(w, human)!;
    const tx = w.width / 2;
    const ty = hq.y + 1;
    for (const u of [knight, foot]) {
      u.x = hq.x + 1;
      u.y = ty;
    }
    for (let i = 0; i < 20; i++) {
      w.tick++;
      moveTo(w, knight, tx, ty, 0.1);
      moveTo(w, foot, tx, ty, 0.1);
    }
    expect(Math.abs(knight.x - hq.x)).toBeGreaterThan(Math.abs(foot.x - hq.x));
    expect(knight.charge).toBeGreaterThanOrEqual(CHARGE_DISTANCE);

    const enemy = w.units.find((u) => u.factionId !== human.id)!;
    expect(troopMultiplier(knight, enemy)).toBeGreaterThan(1);
    enemy.troop = 'spearman';
    expect(troopMultiplier(knight, enemy)).toBe(1); // 長矛兵不吃衝鋒
  });

  it('長矛兵對騎兵傷害加倍', () => {
    const w = createWorld(3);
    const spear = spawnUnit(w, w.factions[0], 'warrior', 'spearman')!;
    const rider = spawnUnit(w, w.factions[1], 'warrior', 'cavalry')!;
    const foot = spawnUnit(w, w.factions[1], 'warrior', 'soldier')!;
    expect(troopMultiplier(spear, rider)).toBe(2);
    expect(troopMultiplier(spear, foot)).toBe(1);
  });
});

describe('林地伏兵', () => {
  it('站在森林裡會隱身，敵人要靠近才看得見', () => {
    const w = createWorld(4);
    const elf = factionOf(w, 'elf');
    const ranger = spawnUnit(w, elf, 'warrior', 'ranger')!;
    const forest = w.tiles.findIndex((t) => t.kind === 'forest');
    ranger.x = (forest % w.width) + 0.5;
    ranger.y = Math.floor(forest / w.width) + 0.5;
    updateStealth(w);
    expect(ranger.hidden).toBe(true);
    expect(isTargetable(ranger, ranger.x + REVEAL_RADIUS + 2, ranger.y)).toBe(false);
    expect(isTargetable(ranger, ranger.x + 1, ranger.y)).toBe(true);

    const foe = w.units.find((u) => u.factionId !== elf.id)!;
    foe.x = ranger.x + REVEAL_RADIUS + 2;
    foe.y = ranger.y;
    expect(nearestEnemyUnit(w, foe, 10)?.id).not.toBe(ranger.id);
    expect(troopMultiplier(ranger, foe)).toBeGreaterThan(1); // 暗箭加成
  });
});

describe('地道工兵', () => {
  it('在地底打不到，抵達後冒出來攻擊建築，對建築傷害加倍', () => {
    const w = createWorld(5);
    const dwarf = factionOf(w, 'dwarf');
    const enemy = w.factions.find((f) => f.id !== dwarf.id)!;
    const sapper = spawnUnit(w, dwarf, 'warrior', 'sapper')!;
    const target = createBuilding(w, enemy, 'house', 30, 20, true);
    sapper.action = { type: 'tunnel', targetId: target.id };
    tunnelTick(w, sapper, target.id);
    expect(sapper.underground).toBe(true);
    expect(isTargetable(sapper, sapper.x, sapper.y)).toBe(false);
    for (let i = 0; i < 2000 && sapper.action.type === 'tunnel'; i++) tunnelTick(w, sapper, target.id);
    expect(sapper.underground).toBe(false);
    expect(sapper.action.type).toBe('attackBuilding');

    const soldier = spawnUnit(w, dwarf, 'warrior', 'soldier')!;
    soldier.attrs = { ...sapper.attrs };
    const b1 = createBuilding(w, enemy, 'house', 40, 20, true);
    const b2 = createBuilding(w, enemy, 'house', 44, 20, true);
    b1.hp = b2.hp = b1.maxHp = b2.maxHp = 100000; // 避免打爆後傷害被截斷
    let sapperDmg = 0;
    let soldierDmg = 0;
    for (let i = 0; i < 20; i++) {
      sapper.cooldown = soldier.cooldown = 0;
      const h1 = b1.hp;
      const h2 = b2.hp;
      strikeBuilding(w, sapper, b1);
      strikeBuilding(w, soldier, b2);
      sapperDmg += h1 - b1.hp;
      soldierDmg += h2 - b2.hp;
    }
    expect(sapperDmg).toBeGreaterThan(soldierDmg * 2);
  });
});

describe('移動速度', () => {
  it('兵種不影響屬性推導的基礎速度', () => {
    const w = createWorld(6);
    const u = spawnUnit(w, w.factions[0], 'warrior', 'cavalry')!;
    expect(speedOf(u.attrs)).toBeGreaterThan(0);
  });
});
