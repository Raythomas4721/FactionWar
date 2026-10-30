import { describe, expect, it } from 'vitest';
import { expandKingdom } from '../src/sim/expansion';
import { createKingdomWorld } from '../src/sim/kingdom';
import { autoChoosePolicy } from '../src/sim/policies';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import { damageBuilding } from '../src/sim/systems/combat';
import type { World } from '../src/sim/types';
import { hqOf } from '../src/sim/util';
import { createWorld, step } from '../src/sim/world';

function run(w: World, n: number) {
  for (let i = 0; i < n && !w.over; i++) {
    autoChoosePolicy(w);
    step(w);
  }
}

/** 存檔讀回後接著跑，和原本的世界走出一模一樣的結果 */
function expectSameFuture(w: World, ticks: number) {
  const copy = deserializeWorld(serializeWorld(w))!;
  expect(copy).not.toBeNull();
  expect(copy.unitMap.size).toBe(w.units.length);
  run(w, ticks);
  run(copy, ticks);
  expect(copy.tick).toBe(w.tick);
  expect(serializeWorld(copy)).toBe(serializeWorld(w));
}

describe('存檔', () => {
  it('王國模式（含戰爭迷霧）讀檔後接著跑，結果和沒存過一樣', () => {
    const w = createKingdomWorld({ player: 'elf', enemy: 'orc', difficulty: 'normal', seed: 42 });
    run(w, 3000);
    expect(w.fog).toBeDefined();
    const copy = deserializeWorld(serializeWorld(w))!;
    expect(copy.fog!.lastSeen).toBeInstanceOf(Int32Array);
    expect(copy.fog!.visible).toBeInstanceOf(Uint8Array);
    expect(copy.kingdom!.aiNextPolicyAt).toBe(w.kingdom!.aiNextPolicyAt);
    expectSameFuture(w, 2000);
  });

  it('永久效果的 Infinity 不會變成 null', () => {
    const w = createKingdomWorld({ player: 'human', enemy: 'undead', difficulty: 'hard', seed: 7 });
    const copy = deserializeWorld(serializeWorld(w))!;
    const until = (x: World) => x.factions.flatMap((f) => f.modifiers.map((m) => m.until));
    expect(until(copy)).toEqual(until(w));
    expect(until(copy)).toContain(Infinity);
  });

  it('第二章（三國鼎立、海軍）也能存', () => {
    const w = createKingdomWorld({ player: 'dwarf', enemy: 'elf', difficulty: 'normal', seed: 9, autoPlay: true, fog: false });
    run(w, 1200);
    damageBuilding(w, hqOf(w, w.factions[1])!, 99999, 0);
    step(w);
    expandKingdom(w);
    run(w, 1500);
    expectSameFuture(w, 1500);
  });

  it('一般模式也能存', () => {
    const w = createWorld(123);
    run(w, 2000);
    expectSameFuture(w, 1000);
  });

  it('壞掉或版本不符的存檔讀不出來', () => {
    expect(deserializeWorld('not json')).toBeNull();
    expect(deserializeWorld('{"version":0,"world":{}}')).toBeNull();
  });
});
