import { describe, expect, it } from 'vitest';
import { WORLD_EVENT_ORDER, eventMult, isEventActive, updateWorldEvents } from '../src/sim/events';
import { castPower } from '../src/sim/powers';
import { TRIALS, createTrialWorld, evaluateTrial, trialById } from '../src/sim/trials';
import { step } from '../src/sim/world';
import { createWorld } from './helpers';

describe('隨機世界事件', () => {
  it('4 分鐘後開始發生事件，會記錄在事件日誌', () => {
    const w = createWorld(1);
    w.tick = 4 * 600 - 1;
    updateWorldEvents(w);
    w.tick++;
    updateWorldEvents(w);
    expect(w.events.some((e) => e.kind === 'world')).toBe(true);
    expect(w.nextEventAt).toBeGreaterThan(w.tick);
  });

  it('關閉隨機事件時不會發生', () => {
    const w = createWorld(1, { rules: { randomEvents: false } });
    w.tick = 10 * 600;
    updateWorldEvents(w);
    expect(w.events.some((e) => e.kind === 'world')).toBe(false);
  });

  it('持續型事件會改變倍率，到期後恢復', () => {
    const w = createWorld(2);
    w.activeEvents.push({ id: 'harvest', until: w.tick + 100 });
    expect(eventMult(w, 'farm')).toBe(2);
    w.activeEvents.push({ id: 'winter', until: w.tick + 100 });
    expect(eventMult(w, 'upkeep')).toBe(1.5);
    w.tick += 200;
    updateWorldEvents(w);
    expect(isEventActive(w, 'harvest')).toBe(false);
    expect(eventMult(w, 'farm')).toBe(1);
  });

  it('所有事件都能觸發而不出錯', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = createWorld(seed);
      for (let i = 0; i < 3; i++) {
        w.tick = w.nextEventAt || 4 * 600;
        updateWorldEvents(w);
      }
    }
    expect(WORLD_EVENT_ORDER.length).toBe(7);
  });
});

describe('造物主的試煉', () => {
  it('每個試煉都能建立，種族與指揮陣營正確', () => {
    for (const def of TRIALS) {
      const w = createTrialWorld(def);
      expect(w.trial?.status).toBe('running');
      expect(w.factions.filter((f) => !f.neutral).map((f) => f.race).sort()).toEqual([...def.races].sort());
      if (def.command) expect(w.factions.find((f) => f.race === def.command)?.playerControlled).toBe(true);
      expect(def.progress(w).length).toBeGreaterThan(0);
    }
  });

  it('試煉中只能用允許的神力', () => {
    const def = trialById('plaguegod')!;
    const w = createTrialWorld(def);
    w.mana = 100;
    expect(castPower(w, 'bless', 10, 10).ok).toBe(false);
    expect(castPower(w, 'plague', w.width / 2, w.height / 2).message).not.toContain('不能使用');
  });

  it('同一個試煉每次的開局都一樣（可以再試一次）', () => {
    const def = trialById('underdog')!;
    const a = createTrialWorld(def);
    const b = createTrialWorld(def);
    expect(a.units.map((u) => [u.x, u.y, u.attrs.str])).toEqual(b.units.map((u) => [u.x, u.y, u.attrs.str]));
  });

  it('瘟疫之神：蟲巢被消滅就成功', () => {
    const w = createTrialWorld(trialById('plaguegod')!);
    const bugs = w.factions.find((f) => f.race === 'insect')!;
    bugs.alive = false;
    evaluateTrial(w);
    expect(w.trial!.status).toBe('won');
    expect(w.over).toBe(true);
  });

  it('弱者的逆襲：人類覆滅就失敗', () => {
    const w = createTrialWorld(trialById('underdog')!);
    w.factions.find((f) => f.race === 'human')!.alive = false;
    evaluateTrial(w);
    expect(w.trial!.status).toBe('lost');
    expect(w.endReason).toContain('試煉失敗');
  });

  it('時間限制到了會判定失敗', () => {
    const w = createTrialWorld(trialById('plaguegod')!);
    w.tick = 15 * 600;
    step(w);
    expect(w.over).toBe(true);
    expect(w.trial!.status).not.toBe('running');
  });
});
