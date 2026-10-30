import { describe, expect, it } from 'vitest';
import { createKingdomWorld } from '../src/sim/kingdom';
import { BERRY_MAX, FISH_MAX } from '../src/sim/map';
import { findNearestResource, gatherTick, updateRegrowth } from '../src/sim/systems/economy';
import { TUNNEL_COST, findPath, moveTo } from '../src/sim/systems/movement';
import { factionUnits, spawnUnit } from '../src/sim/util';
import { createBlankWorld, createFaction, step } from '../src/sim/world';
import type { World } from '../src/sim/types';

const kingdom = () => createKingdomWorld({ player: 'human', enemy: 'orc', difficulty: 'normal', seed: 3, fog: false });

/** 中間一道水牆隔開左右，只有古地道相通 */
function walledWorld(): World {
  const w = createBlankWorld(1, 30, 10);
  for (let y = 0; y < 10; y++) w.tiles[y * 30 + 15].kind = 'water';
  w.tunnels = [{ id: 1, a: { x: 2, y: 5 }, b: { x: 27, y: 5 } }];
  return w;
}

describe('河流與古地道', () => {
  it('1v1 地圖有河、有池塘、有一條點對稱的古地道', () => {
    const w = kingdom();
    expect(w.tiles.filter((t) => t.kind === 'water').length).toBeGreaterThan(80);
    expect(w.tunnels).toHaveLength(1);
    const t = w.tunnels[0];
    expect(t.a.x + t.b.x).toBe(w.width - 1);
    expect(t.a.y + t.b.y).toBe(w.height - 1);
  });

  it('過不了水時，尋路會走地道', () => {
    const w = walledWorld();
    const path = findPath(w, 1, 5, 28, 5)!;
    expect(path).not.toBeNull();
    const i = path.findIndex((p) => p.x === 2 && p.y === 5);
    expect(path[i + 1]).toEqual({ x: 27, y: 5 });
  });

  it('地道比繞路遠就不走', () => {
    const w = createBlankWorld(1, 30, 10);
    w.tunnels = [{ id: 1, a: { x: 2, y: 5 }, b: { x: 6, y: 5 } }];
    const path = findPath(w, 1, 5, 8, 5)!;
    expect(path.length).toBeLessThan(TUNNEL_COST);
    expect(path.every((p, i) => i === 0 || Math.abs(p.x - path[i - 1].x) <= 1)).toBe(true);
  });

  it('小人鑽進地道會消失一陣子，再從另一頭冒出來', () => {
    const w = walledWorld();
    const f = createFaction(w, 'human', ['human']);
    const u = spawnUnit(w, f, 'worker', 'soldier', { x: 1.5, y: 5.5 })!;
    let wentUnder = false;
    for (let i = 0; i < 600 && !moveTo(w, u, 28.5, 5.5, 0.3); i++) {
      w.tick++;
      if (u.underground) wentUnder = true;
      if (w.tick < u.surfaceAt) continue;
      u.underground = false;
    }
    expect(wentUnder).toBe(true);
    expect(Math.abs(u.x - 28.5)).toBeLessThan(0.35);
  });
});

describe('釣魚與漿果再生', () => {
  it('工人會在岸邊釣魚，水域不會被釣乾變成草地', () => {
    const w = kingdom();
    const me = w.factions[0];
    const u = factionUnits(w, me.id).find((x) => x.role === 'worker')!;
    // 把附近的漿果都摘光，只剩水可以找糧食
    for (const t of w.tiles) if (t.kind === 'berries') t.amount = 0;
    const spot = findNearestResource(w, u, 'food')!;
    const tile = w.tiles[spot.y * w.width + spot.x];
    expect(tile.kind).toBe('water');
    tile.amount = 0.5;
    for (let i = 0; i < 400; i++) gatherTick(w, u, 'food', spot.x, spot.y);
    expect(u.carrying?.amount).toBeCloseTo(0.5);
    expect(tile.kind).toBe('water');
    expect(w.tiles[Math.floor(u.y) * w.width + Math.floor(u.x)].kind).not.toBe('water');
  });

  it('摘光的漿果叢與魚群會慢慢長回來', () => {
    const w = kingdom();
    const berry = w.tiles.find((t) => t.kind === 'berries')!;
    const fish = w.tiles.find((t) => t.kind === 'water')!;
    berry.amount = 0;
    fish.amount = 0;
    for (let i = 0; i < 6000; i++) {
      w.tick++;
      updateRegrowth(w);
    }
    expect(berry.kind).toBe('berries');
    expect(berry.amount).toBeCloseTo(BERRY_MAX);
    expect(fish.amount).toBeCloseTo(FISH_MAX);
  });

  it('後期還有糧食可以補兵', () => {
    const w = kingdom();
    w.factions[0].playerControlled = false;
    w.kingdom!.nextPolicyAt = Infinity;
    for (let i = 0; i < 6000 && !w.over; i++) step(w);
    const berries = w.tiles.filter((t) => t.kind === 'berries');
    expect(berries.length).toBeGreaterThan(10);
  });
});
