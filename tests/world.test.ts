import { describe, expect, it } from 'vitest';
import { issueCommand } from '../src/sim/commands';
import { runGame } from '../src/sim/headless';
import { findPath } from '../src/sim/systems/movement';
import { placeBuilding } from '../src/sim/systems/building';
import { createBlankWorld, createWorld, step } from '../src/sim/world';

function snapshot(seed: number, ticks: number) {
  const w = createWorld(seed);
  for (let i = 0; i < ticks; i++) step(w);
  return JSON.stringify({
    units: w.units.map((u) => [u.id, u.factionId, Math.round(u.x * 100), Math.round(u.y * 100), Math.round(u.hp)]),
    res: w.factions.map((f) => f.resources),
    events: w.events.length,
  });
}

describe('世界模擬', () => {
  it('同一個種子跑出完全相同的戰局', () => {
    expect(snapshot(7, 1500)).toBe(snapshot(7, 1500));
  });

  it('不同種子跑出不同的戰局', () => {
    expect(snapshot(7, 300)).not.toBe(snapshot(8, 300));
  });

  it('地圖四個象限對稱', () => {
    const w = createWorld(3);
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        expect(w.tiles[y * w.width + x].kind).toBe(w.tiles[y * w.width + (w.width - 1 - x)].kind);
        expect(w.tiles[y * w.width + x].kind).toBe(w.tiles[(w.height - 1 - y) * w.width + x].kind);
      }
    }
  });

  it('一整場對局能跑到結束並產生勝者', () => {
    const result = runGame(11);
    expect(result.winner).not.toBeNull();
    expect(result.factions.some((f) => f.crafted > 0)).toBe(true);
    expect(result.factions.some((f) => f.built > 0)).toBe(true);
  }, 60_000);
});

describe('尋路', () => {
  it('會繞過水域', () => {
    const w = createBlankWorld(1, 10, 10);
    for (let y = 0; y < 9; y++) w.tiles[y * 10 + 5].kind = 'water';
    const path = findPath(w, 2, 2, 8, 2)!;
    expect(path).not.toBeNull();
    expect(path.every((p) => w.tiles[p.y * 10 + p.x].kind !== 'water')).toBe(true);
    expect(path.some((p) => p.y === 9)).toBe(true);
  });

  it('目標在水裡時回傳 null', () => {
    const w = createBlankWorld(1, 10, 10);
    w.tiles[55].kind = 'water';
    expect(findPath(w, 0, 0, 5, 5)).toBeNull();
  });
});

describe('建築與指令', () => {
  it('科技不足不能蓋鍛造坊，升級後可以', () => {
    const w = createWorld(5);
    const f = w.factions[0];
    f.resources = { wood: 500, stone: 500, ore: 0, food: 0 };
    expect(placeBuilding(w, f, 'forge')).toBeNull();
    f.tech = 1;
    expect(placeBuilding(w, f, 'forge')).not.toBeNull();
  });

  it('矮人蓋石造建築比較便宜', () => {
    const w = createWorld(5);
    const dwarves = w.factions.find((f) => f.race === 'dwarf')!;
    const humans = w.factions.find((f) => f.race === 'human')!;
    for (const f of [dwarves, humans]) {
      f.tech = 1;
      f.resources = { wood: 100, stone: 100, ore: 0, food: 0 };
      placeBuilding(w, f, 'forge');
    }
    expect(dwarves.resources.stone).toBeGreaterThan(humans.resources.stone);
  });

  it('訓練指令會消耗糧食並產生新單位', () => {
    const w = createWorld(5);
    const f = w.factions[0];
    f.resources.food = 100;
    f.nextAiAt = Infinity; // 不讓 AI 插手
    const before = w.units.filter((u) => u.factionId === f.id).length;
    issueCommand(w, f.id, { type: 'train', role: 'warrior' });
    step(w);
    expect(w.units.filter((u) => u.factionId === f.id).length).toBe(before + 1);
    expect(f.resources.food).toBeLessThan(100);
  });
});
