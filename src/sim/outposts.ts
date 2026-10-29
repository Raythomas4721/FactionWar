import type { ModKey, OutpostKind, Resources } from './types';

/** 據點的種類與效果（純資料，給模擬與畫面共用） */
export interface OutpostDef {
  kind: OutpostKind;
  name: string;
  icon: string;
  /** 地圖上的字 */
  glyph: string;
  desc: string;
  /** 佔領者在這裡的視野半徑 */
  vision: number;
  /** 每 tick 給佔領者的資源 */
  income?: Partial<Resources>;
  /** 佔領者的全軍倍率 */
  mods?: Partial<Record<ModKey, number>>;
}

export const OUTPOST_DEFS: Record<OutpostKind, OutpostDef> = {
  mine: {
    kind: 'mine', name: '礦場', icon: '⛏', glyph: '礦',
    desc: '持續產出糧食、木材、石材與鐵礦',
    vision: 5,
    income: { food: 0.03, wood: 0.02, stone: 0.02, ore: 0.03 },
  },
  watchtower: {
    kind: 'watchtower', name: '瞭望塔', icon: '🗼', glyph: '望',
    desc: '視野極廣（可看穿戰爭迷霧），還會射擊靠近的敵人',
    vision: 13,
  },
  shrine: {
    kind: 'shrine', name: '戰神祠', icon: '⛩', glyph: '祠',
    desc: '佔領者全軍傷害 +10%、英雄經驗 +30%',
    vision: 5,
    mods: { damage: 1.1, xp: 1.3 },
  },
};

/** 站在這個範圍內才算在佔領 */
export const CAPTURE_RADIUS = 2.2;
/** 一名戰士佔領中立據點要 15 秒；人越多越快（最多 3 倍），搶敵人的據點要兩倍時間 */
export const CAPTURE_TICKS = 150;
export const WATCHTOWER_RANGE = 6;
export const WATCHTOWER_DAMAGE = 5;
export const WATCHTOWER_COOLDOWN = 15;
