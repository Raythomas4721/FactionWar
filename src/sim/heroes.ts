import type { RaceId } from './types';

/** 英雄流派（Build） */
export type HeroPath = 'crit' | 'venom' | 'summon' | 'berserk' | 'guardian';

export type TalentId =
  | 'critChance' | 'critDamage' | 'glass'
  | 'venomStacks' | 'venomPotency' | 'plagueBearer'
  | 'moreSummons' | 'strongSummons' | 'longSummons'
  | 'bloodlust' | 'lifesteal' | 'unstoppable'
  | 'wideAura' | 'critAura' | 'ironAura'
  | 'power' | 'haste' | 'vigor' | 'swiftness';

export interface PathDef {
  id: HeroPath;
  name: string;
  icon: string;
  /** 英雄稱號 */
  title: string;
  desc: string;
  skill: { name: string; desc: string; cooldown: number };
  talents: TalentId[];
}

export const PATHS: Record<HeroPath, PathDef> = {
  crit: {
    id: 'crit', name: '暴擊流', icon: '⚔', title: '疾影',
    desc: '15% 暴擊率、暴擊 ×2；生命 -15%',
    skill: { name: '致命一擊', desc: '下一擊必定暴擊，傷害 ×3', cooldown: 300 },
    talents: ['critChance', 'critDamage', 'glass'],
  },
  venom: {
    id: 'venom', name: '毒傷流', icon: '☠', title: '毒牙',
    desc: '攻擊疊加劇毒（持續傷害，越久越痛）；直接傷害 -15%',
    skill: { name: '毒霧', desc: '周圍 3 格內的敵人各中 2 層毒', cooldown: 400 },
    talents: ['venomStacks', 'venomPotency', 'plagueBearer'],
  },
  summon: {
    id: 'summon', name: '召喚流', icon: '✦', title: '喚靈者',
    desc: '定期召喚援兵；本身傷害 -30%',
    skill: { name: '群召', desc: '立刻召喚 2 名援兵', cooldown: 500 },
    talents: ['moreSummons', 'strongSummons', 'longSummons'],
  },
  berserk: {
    id: 'berserk', name: '狂戰流', icon: '🔥', title: '狂戰士',
    desc: '生命越低，攻擊越高（瀕死時傷害翻倍）',
    skill: { name: '狂暴', desc: '15 秒內攻速加倍，造成傷害的 30% 回復生命', cooldown: 450 },
    talents: ['bloodlust', 'lifesteal', 'unstoppable'],
  },
  guardian: {
    id: 'guardian', name: '守護流', icon: '🛡', title: '守護者',
    desc: '光環讓周圍隊友 +10% 暴擊率、+2 減傷；本身傷害 -20%、生命 +20%',
    skill: { name: '守護之光', desc: '光環內隊友回復 30% 生命、士氣全滿', cooldown: 500 },
    talents: ['wideAura', 'critAura', 'ironAura'],
  },
};

export const PATH_ORDER: HeroPath[] = ['crit', 'venom', 'summon', 'berserk', 'guardian'];

export const TALENTS: Record<TalentId, { name: string; desc: string }> = {
  critChance: { name: '精準', desc: '暴擊率 +10%' },
  critDamage: { name: '致命', desc: '暴擊傷害 +75%' },
  glass: { name: '玻璃大砲', desc: '攻擊 +25%，但生命 -15%' },
  venomStacks: { name: '層層劇毒', desc: '毒層數上限 +2' },
  venomPotency: { name: '烈性毒素', desc: '毒傷 +60%' },
  plagueBearer: { name: '瘟疫散播', desc: '中毒的敵人死亡時，毒會擴散給附近敵人' },
  moreSummons: { name: '大軍', desc: '同時召喚數量 +1' },
  strongSummons: { name: '精銳', desc: '召喚物全屬性 +4' },
  longSummons: { name: '契約', desc: '召喚物存在時間 ×2' },
  bloodlust: { name: '嗜血', desc: '低血量的攻擊加成 ×1.5' },
  lifesteal: { name: '飲血', desc: '平時也能吸取 20% 傷害回復生命' },
  unstoppable: { name: '不屈', desc: '生命低於 30% 時受到的傷害 -30%' },
  wideAura: { name: '廣域', desc: '光環半徑 +2' },
  critAura: { name: '戰意', desc: '光環的暴擊加成再 +10%' },
  ironAura: { name: '鐵壁', desc: '光環的減傷再 +2' },
  power: { name: '強攻', desc: '攻擊 +20%' },
  haste: { name: '迅攻', desc: '攻速 +25%' },
  vigor: { name: '強健', desc: '生命 +25%' },
  swiftness: { name: '疾行', desc: '移動速度 +20%' },
};

export const GENERIC_TALENTS: TalentId[] = ['power', 'haste', 'vigor', 'swiftness'];

/** 各等級需要的累積經驗 */
export const XP_LEVELS = [0, 0, 25, 60, 110, 180, 270];
export const MAX_LEVEL = 6;
export const PROMOTE_KILLS = 4;
export const MAX_HEROES = 2;

export const XP_KILL = 10;
export const XP_KILL_HERO = 25;
export const XP_KILL_MONSTER = 30;

export const BASE_CRIT_MULT = 2;
/** 毒爆：暴擊打在中毒的敵人身上再 ×1.5 */
export const VENOM_BURST = 1.5;
export const POISON_TICKS = 100;
export const POISON_DPS = 0.05;
export const AURA_RADIUS = 5;
export const SUMMON_INTERVAL = 300;
export const SUMMON_LIFETIME = 900;

/** 各種族偏好的流派 */
export const PATH_AFFINITY: Record<RaceId, Partial<Record<HeroPath, number>>> = {
  orc: { berserk: 2, crit: 0.5 },
  elf: { crit: 1.5, venom: 1 },
  dwarf: { guardian: 1.5, berserk: 1 },
  human: { guardian: 1.5, crit: 1 },
  undead: { summon: 2, venom: 1 },
  insect: { venom: 2, summon: 1 },
  beast: {},
};

/** 召喚物的種族風味 */
export const SUMMON_NAMES: Record<RaceId, string> = {
  orc: '戰狼',
  elf: '樹靈',
  dwarf: '石魔像',
  human: '民兵',
  undead: '骷髏',
  insect: '工蟲群',
  beast: '幼獸',
};
