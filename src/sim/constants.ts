export const TICKS_PER_SECOND = 10;
export const MAP_W = 64;
export const MAP_H = 48;
export const BUILDING_SIZE = 2;

export const SIGHT = 7;
export const MELEE_RANGE = 1.3;
export const HQ_THREAT_RADIUS = 11;
export const HQ_REST_RADIUS = 3.5;
export const MAX_BUILDERS = 3;

export const MAX_TICKS = 18000;
/** 開局休戰期：這段時間內陣營 AI 不會主動進攻，讓經濟與科技有時間發展 */
export const PEACE_TICKS = 3000;
/** 敵人進到營帳這個範圍內，工人與鐵匠也會拿起武器保衛家園 */
export const MILITIA_RADIUS = 6;
export const AI_INTERVAL = 20;

/** 累積研究點數達到門檻即升級科技 */
export const TECH_THRESHOLDS = [0, 150, 450, 1000, 1800];
export const MAX_TECH = TECH_THRESHOLDS.length - 1;
