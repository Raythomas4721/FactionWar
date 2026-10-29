import type { Faction, ModKey, Modifier, World } from './types';

/** 陣營目前的倍率：所有還沒到期的修正相乘 */
export function modOf(world: World, factionId: number, key: ModKey): number {
  const f = world.factions[factionId];
  if (!f || !f.modifiers.length) return 1;
  let m = 1;
  for (const x of f.modifiers) if (x.until > world.tick) m *= x.mods[key] ?? 1;
  return m;
}

/** 堅壁清野之類的國策：期間不能下令進攻 */
export function attackForbidden(world: World, f: Faction): boolean {
  return f.modifiers.some((x) => x.noAttack && x.until > world.tick);
}

export function activeModifiers(world: World, f: Faction): Modifier[] {
  return f.modifiers.filter((x) => x.until > world.tick && !x.hidden);
}
