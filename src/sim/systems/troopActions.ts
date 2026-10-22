import { BUILDING_DEFS } from '../buildings';
import { dist } from '../math';
import { speedOf } from '../stats';
import { REVEAL_TICKS, TUNNEL_SPEED, troopName } from '../troops';
import type { Point, Unit, World } from '../types';
import { areHostile, centerOf, distToBuilding, getBuilding, hqOf, logEvent, tileAt } from '../util';
import { moveTo } from './movement';

/** 林地伏兵站在森林、而且最近沒有放箭時就會隱身；不在挖地道的工兵一律回到地面 */
export function updateStealth(world: World): void {
  for (const u of world.units) {
    if (u.underground && u.action.type !== 'tunnel') u.underground = false;
    if (u.troop !== 'ranger' || u.hp <= 0) {
      u.hidden = false;
      continue;
    }
    const tile = tileAt(world, Math.floor(u.x), Math.floor(u.y));
    u.hidden = tile?.kind === 'forest' && world.tick >= u.revealedUntil;
  }
}

/** 攻擊會暴露伏兵的位置一小段時間 */
export function revealAfterAttack(world: World, u: Unit): void {
  if (u.troop === 'ranger') {
    u.revealedUntil = world.tick + REVEAL_TICKS;
    u.hidden = false;
  }
}

/**
 * 地道工兵：在地底直線挖向目標建築（不受地形與水域限制），
 * 冒出地面後改成正常攻擊那棟建築。
 */
export function tunnelTick(world: World, u: Unit, targetId: number): boolean {
  const b = getBuilding(world, targetId);
  if (!b || !areHostile(world, u.factionId, b.factionId)) {
    u.underground = false;
    return false;
  }
  if (!u.underground) {
    u.underground = true;
    u.path.length = 0;
  }
  const c = centerOf(b);
  if (distToBuilding(u.x, u.y, b) <= 1) {
    u.underground = false;
    const f = world.factions[u.factionId];
    logEvent(
      world,
      'combat',
      `${f.name}的${troopName(u.troop, u.race)} ${u.name} 從地底竄出，直撲${world.factions[b.factionId].name}的${BUILDING_DEFS[b.type].name}！`,
      f.id,
    );
    u.action = { type: 'attackBuilding', targetId };
    return true;
  }
  const speed = speedOf(u.attrs) * TUNNEL_SPEED;
  const d = dist(u.x, u.y, c.x, c.y);
  u.x += ((c.x - u.x) / d) * speed;
  u.y += ((c.y - u.y) / d) * speed;
  return true;
}

/** 伏擊點：從自家營帳往最近敵營方向約 9 格內，離那條線最近的森林格 */
export function findAmbushSpot(world: World, u: Unit): Point | null {
  const f = world.factions[u.factionId];
  const hq = hqOf(world, f);
  if (!hq) return null;
  const home = centerOf(hq);
  let nearestFoe: Point | null = null;
  let foeD = Infinity;
  for (const o of world.factions) {
    if (!o.alive || !areHostile(world, f.id, o.id)) continue;
    const ohq = hqOf(world, o);
    if (!ohq) continue;
    const c = centerOf(ohq);
    const d = dist(home.x, home.y, c.x, c.y);
    if (d < foeD) {
      foeD = d;
      nearestFoe = c;
    }
  }
  if (!nearestFoe) return null;
  const want = {
    x: home.x + ((nearestFoe.x - home.x) / foeD) * 9,
    y: home.y + ((nearestFoe.y - home.y) / foeD) * 9,
  };
  let best: Point | null = null;
  let bestD = 8;
  for (let y = Math.floor(want.y - 8); y <= want.y + 8; y++) {
    for (let x = Math.floor(want.x - 8); x <= want.x + 8; x++) {
      if (tileAt(world, x, y)?.kind !== 'forest') continue;
      // 每個伏兵用自己的 id 錯開一點，免得全擠在同一格
      const d = dist(x + 0.5, y + 0.5, want.x, want.y) + ((x * 7 + y * 13 + u.id) % 5) * 0.3;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

export function ambushTick(world: World, u: Unit, x: number, y: number): boolean {
  if (tileAt(world, x, y)?.kind !== 'forest') return false;
  moveTo(world, u, x + 0.5, y + 0.5, 0.3);
  return true;
}
