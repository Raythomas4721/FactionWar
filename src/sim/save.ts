import { Rng } from './rng';
import type { World } from './types';

/**
 * 存檔：把整個世界轉成 JSON 字串，讀回來後接著跑，結果和沒存過一模一樣。
 * JSON 不支援的值用標記保存：Infinity、亂數產生器、戰爭迷霧的陣列；unitMap 讀檔時重建。
 */

export const SAVE_VERSION = 1;

interface SaveFile {
  version: number;
  world: unknown;
}

function replacer(this: unknown, key: string, value: unknown): unknown {
  if (key === 'unitMap') return undefined;
  if (value instanceof Rng) return { $rng: value.state };
  if (value instanceof Int32Array) return { $i32: Array.from(value) };
  if (value instanceof Uint8Array) return { $u8: Array.from(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if ('$rng' in v) return Rng.fromState(v.$rng as number);
  if ('$i32' in v) return Int32Array.from(v.$i32 as number[]);
  if ('$u8' in v) return Uint8Array.from(v.$u8 as number[]);
  if ('$num' in v) return Number(v.$num);
  return value;
}

export function serializeWorld(world: World): string {
  const file: SaveFile = { version: SAVE_VERSION, world };
  return JSON.stringify(file, replacer);
}

/** 讀檔；版本不符或內容壞掉時回傳 null */
export function deserializeWorld(text: string): World | null {
  try {
    const file = JSON.parse(text, reviver) as SaveFile;
    if (file?.version !== SAVE_VERSION || !file.world) return null;
    const world = file.world as World;
    world.unitMap = new Map(world.units.map((u) => [u.id, u]));
    return world;
  } catch {
    return null;
  }
}
