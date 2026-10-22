import { describe, expect, it } from 'vitest';
import { ITEM_DEFS, itemDef, itemPower, resolveDef } from '../src/sim/items';
import { createBuilding, buildTick, completeBuilding } from '../src/sim/systems/building';
import { cooldownOf } from '../src/sim/stats';
import { strikeBuilding, strikeUnit } from '../src/sim/systems/combat';
import { craftTick, pickCraftDef, startCraft } from '../src/sim/systems/crafting';
import { infectionRisk } from '../src/sim/systems/health';
import {
  buildingQualityOf, designBlueprint, inventionChance, maybeInvent,
} from '../src/sim/systems/invention';
import { spawnUnit } from '../src/sim/util';
import { createWorld } from '../src/sim/world';

describe('發明機率', () => {
  it('智慧 10 以下不會發明，越聰明機率越高，有書院更高', () => {
    const w = createWorld(1);
    const f = w.factions[0];
    const smith = spawnUnit(w, f, 'smith')!;
    smith.attrs.int = 10;
    expect(inventionChance(w, smith, f)).toBe(0);
    smith.attrs.int = 14;
    const noLib = inventionChance(w, smith, f);
    expect(noLib).toBeGreaterThan(0);
    smith.attrs.int = 18;
    expect(inventionChance(w, smith, f)).toBeGreaterThan(noLib);
    smith.attrs.int = 14;
    createBuilding(w, f, 'library', 20, 20, true);
    expect(inventionChance(w, smith, f)).toBeGreaterThan(noLib);
  });

  it('發明頻率為 0 時永遠不會發明', () => {
    const w = createWorld(1, { rules: { inventionMult: 0 } });
    const smith = spawnUnit(w, w.factions[0], 'smith')!;
    smith.attrs.int = 20;
    expect(inventionChance(w, smith, w.factions[0])).toBe(0);
  });
});

describe('藍圖', () => {
  it('以發明者命名、比原版強、成本較高，智慧 16 以上有兩種特效', () => {
    const w = createWorld(2);
    const smith = spawnUnit(w, w.factions[0], 'smith')!;
    smith.attrs.int = 13;
    const base = ITEM_DEFS.ironSword;
    const bp = designBlueprint(w, smith, base);
    expect(bp.name).toContain(smith.name);
    expect(bp.name).toContain(base.name);
    expect(bp.dmg).toBeGreaterThan(base.dmg);
    expect(bp.cost.ore!).toBeGreaterThan(base.cost.ore!);
    expect(bp.traits).toHaveLength(1);
    smith.attrs.int = 17;
    expect(designBlueprint(w, smith, base).traits).toHaveLength(2);
  });

  it('發明後陣營可以打造藍圖，成品自帶藍圖定義', () => {
    const w = createWorld(3, { rules: { inventionMult: 100 } });
    const f = w.factions[0];
    const smith = spawnUnit(w, f, 'smith')!;
    smith.attrs.int = 16;
    const bp = maybeInvent(w, smith, pickCraftDef(f, false, 'weapon', false)!)!;
    expect(bp).not.toBeNull();
    expect(f.blueprints).toContain(bp);
    expect(f.stats.inventions).toBe(1);
    expect(w.events.at(-1)?.kind).toBe('invention');
    expect(pickCraftDef(f, false, 'weapon', false)?.id).toBe(bp.id); // AI 會優先打造更強的藍圖
    expect(resolveDef(f, bp.id)).toBe(bp);

    f.resources = { wood: 999, stone: 999, ore: 999, food: 999 };
    f.craftQueue = [bp.id];
    expect(startCraft(w, smith)).toBe(true);
    for (let i = 0; i < 5000 && smith.action.type === 'craft'; i++) {
      if (!craftTick(w, smith)) break;
    }
    const item = f.armory.find((i) => i.defId === bp.id)!;
    expect(item).toBeDefined();
    expect(itemDef(item)).toBe(bp);
    expect(itemPower(item)).toBeGreaterThan(0);
  });
});

describe('藍圖特效', () => {
  const armed = (trait: string) => {
    const w = createWorld(4, { rules: { diseaseMult: 3 } });
    const a = spawnUnit(w, w.factions[0], 'warrior')!;
    const def = { ...ITEM_DEFS.ironSword, id: 'bp:test', inventor: 'X', traits: [trait as never] };
    a.weapon = { id: 999, defId: def.id, quality: 1, maker: 'X', custom: def };
    return { w, a };
  };

  it('輕羽：攻擊冷卻較短', () => {
    const { w, a } = armed('swift');
    const target = spawnUnit(w, w.factions[1], 'worker')!;
    strikeUnit(w, a, target);
    expect(a.cooldown).toBeLessThan(cooldownOf(a.attrs));
  });

  it('烈焰：拆建築傷害加倍', () => {
    const { w, a } = armed('flame');
    const plain = spawnUnit(w, w.factions[0], 'warrior')!;
    plain.attrs = { ...a.attrs };
    plain.weapon = { id: 998, defId: 'ironSword', quality: 1, maker: 'Y' };
    const b1 = createBuilding(w, w.factions[1], 'house', 30, 20, true);
    const b2 = createBuilding(w, w.factions[1], 'house', 34, 20, true);
    b1.hp = b2.hp = 100000;
    let flame = 0;
    let normal = 0;
    for (let i = 0; i < 20; i++) {
      a.cooldown = plain.cooldown = 0;
      const h1 = b1.hp;
      const h2 = b2.hp;
      strikeBuilding(w, a, b1);
      strikeBuilding(w, plain, b2);
      flame += h1 - b1.hp;
      normal += h2 - b2.hp;
    }
    expect(flame).toBeGreaterThan(normal * 1.6);
  });

  it('淬毒：命中可能讓敵人染病', () => {
    const { w, a } = armed('venom');
    let infected = false;
    for (let i = 0; i < 200 && !infected; i++) {
      const t = spawnUnit(w, w.factions[1], 'worker')!;
      t.attrs.con = 3;
      t.attrs.agi = 1;
      a.cooldown = 0;
      strikeUnit(w, a, t);
      infected = t.sick;
    }
    expect(infected).toBe(true);
  });

  it('祝聖護甲：染病風險減半', () => {
    const w = createWorld(5);
    const u = spawnUnit(w, w.factions[0], 'warrior')!;
    const before = infectionRisk(w, u);
    const def = { ...ITEM_DEFS.leather, id: 'bp:armor', inventor: 'Z', traits: ['blessed' as const] };
    u.armor = { id: 997, defId: def.id, quality: 1, maker: 'Z', custom: def };
    expect(infectionRisk(w, u)).toBeCloseTo(before / 2);
  });
});

describe('建築品質', () => {
  it('智慧越高的工人蓋出品質越好的建築', () => {
    expect(buildingQualityOf(14)).toBeGreaterThan(1);
    expect(buildingQualityOf(10)).toBe(1);
    expect(buildingQualityOf(6)).toBeLessThan(1);
  });

  it('完工時依建造者智慧決定耐久', () => {
    const w = createWorld(6);
    const f = w.factions[0];
    const smart = spawnUnit(w, f, 'worker')!;
    const dull = spawnUnit(w, f, 'worker')!;
    smart.attrs.int = 18;
    dull.attrs.int = 4;
    const a = createBuilding(w, f, 'house', 20, 20, false);
    const b = createBuilding(w, f, 'house', 24, 20, false);
    for (const [u, site] of [[smart, a], [dull, b]] as const) {
      u.x = site.x + 1;
      u.y = site.y + 1;
      for (let i = 0; i < 5000 && !site.complete; i++) buildTick(w, u, site.id);
    }
    expect(a.complete && b.complete).toBe(true);
    expect(a.quality).toBeGreaterThan(b.quality);
    expect(a.maxHp).toBeGreaterThan(b.maxHp);
    // 直接完工（沒有人蓋）時為標準品質
    const c = createBuilding(w, f, 'farm', 28, 20, false);
    completeBuilding(w, c);
    expect(c.quality).toBe(1);
  });
});
