export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
