import { CLASSIC_RACES } from '../src/sim/races';
import type { WorldRules } from '../src/sim/rules';
import { createWorld as createRawWorld, type WorldOptions } from '../src/sim/world';

/** 測試預設使用經典四族，結果才穩定；需要新種族時在 rules.raceSelection 指定 */
export function createWorld(seed: number, opts: WorldOptions = {}) {
  const rules: Partial<WorldRules> = { raceSelection: CLASSIC_RACES, ...opts.rules };
  return createRawWorld(seed, { ...opts, rules });
}
