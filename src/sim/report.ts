import { itemDef } from './items';
import { RACES } from './races';
import type { Faction, World } from './types';

export interface Finding {
  /** 發生了什麼 */
  text: string;
  /** 下次可以怎麼做 */
  tip: string;
  /** 嚴重程度，用來排序 */
  weight: number;
}

export interface FactionReport {
  faction: Faction;
  won: boolean;
  headline: string;
  findings: Finding[];
}

/** 對手（勝者）的兵力特色，給出針對性的建議 */
function counterTip(world: World, winner: Faction): string {
  const army = world.units.filter((u) => u.factionId === winner.id && u.hp > 0 && u.role === 'warrior');
  const cavalry = army.filter((u) => u.troop === 'cavalry').length;
  const armor = army.reduce((s, u) => s + (u.armor ? itemDef(u.armor).armor * u.armor.quality : 0), 0) / Math.max(1, army.length);
  if (RACES[winner.race].unholy) return `${winner.name}怕火與聖光：發明或奪取「烈焰」武器，或用祝福灼燒它們`;
  if (winner.race === 'insect') return `${winner.name}擠在一起易染疫：用瘟疫神力、淬毒武器或毒傷流英雄`;
  if (cavalry >= 3) return `${winner.name}有 ${cavalry} 名騎兵：多練長矛兵（對騎兵傷害 ×2、不吃衝鋒）`;
  if (armor >= 3) return `${winner.name}護甲厚（平均減傷 ${armor.toFixed(1)}）：需要「破甲」武器`;
  return '提升裝備品質：早點蓋鍛造坊、多派鐵匠，或找守護流英雄帶隊';
}

/** 戰局結束時，分析每個陣營為什麼輸（或為什麼贏） */
export function analyzeGame(world: World): FactionReport[] {
  const contenders = world.factions.filter((f) => !f.neutral);
  const winner = world.winner !== null ? world.factions[world.winner] : null;
  const lairsOf = (f: Faction) => world.lairs.filter((l) => l.claimedBy === f.id).length;

  return contenders.map((f) => {
    const s = f.stats;
    if (winner && f.id === winner.id) {
      const strengths: string[] = [];
      if (s.heroes) strengths.push(`誕生 ${s.heroes} 名英雄`);
      if (lairsOf(f)) strengths.push(`奪得 ${lairsOf(f)} 座巢穴寶藏`);
      if (s.inventions) strengths.push(`發明 ${s.inventions} 張藍圖`);
      if (s.recruited) strengths.push(`策反 ${s.recruited} 人`);
      strengths.push(`擊殺 ${s.kills}、陣亡 ${s.deaths}`);
      return { faction: f, won: true, headline: `勝出：${strengths.join('、')}`, findings: [] };
    }

    const findings: Finding[] = [];
    if (s.infections > 25 || s.diseaseDeaths >= 3) {
      findings.push({
        text: `疫病肆虐：${s.infections} 人次染病、${s.diseaseDeaths} 人病死`,
        tip: '蓋醫館、討伐「生命之泉」巢穴，或讓體質高的族人上前線',
        weight: s.diseaseDeaths * 3 + s.infections / 5,
      });
    }
    if (s.starved > 0) {
      findings.push({
        text: `飢荒：${s.starved} 人餓死`,
        tip: '多蓋農田、別一次訓練太多人（世界法則也能調低糧食消耗）',
        weight: s.starved * 4,
      });
    }
    if (s.defected >= 2) {
      findings.push({
        text: `${s.defected} 人被敵方外交官策反`,
        tip: '糧食充足、士氣穩定，忠誠度才不會動搖；「不屈意志」秘術可以加忠誠',
        weight: s.defected * 3,
      });
    }
    if (winner && s.deaths >= 10 && s.kills < s.deaths * 0.7) {
      findings.push({
        text: `戰損比吃虧（擊殺 ${s.kills}：陣亡 ${s.deaths}）`,
        tip: counterTip(world, winner),
        weight: (s.deaths - s.kills) / 2,
      });
    }
    if (winner && f.tech < winner.tech) {
      findings.push({
        text: `科技落後（Lv${f.tech}，對手 Lv${winner.tech}）`,
        tip: '蓋書院、保護高智慧的工匠；「智慧之書」秘術可以加速研究',
        weight: (winner.tech - f.tech) * 6,
      });
    }
    if (winner && lairsOf(winner) > 0 && lairsOf(f) === 0) {
      findings.push({
        text: `對手奪得 ${lairsOf(winner)} 座巢穴寶藏，你一座也沒有`,
        tip: '兵力是守衛兩倍以上時就去討伐巢穴（指揮面板的「🏆 討伐巢穴」）',
        weight: lairsOf(winner) * 5,
      });
    }
    if (winner && winner.stats.heroes > 0 && s.heroes === 0) {
      findings.push({
        text: `沒有誕生英雄（對手有 ${winner.stats.heroes} 名）`,
        tip: '集中兵力打勝仗，戰士擊殺 4 人就會晉升英雄；可以附身英雄親自帶隊',
        weight: winner.stats.heroes * 4,
      });
    }
    findings.sort((a, b) => b.weight - a.weight);
    const headline = f.fallReason ?? (f.alive ? '存活到最後，但分數不及勝者' : '覆滅');
    return { faction: f, won: false, headline, findings: findings.slice(0, 3) };
  });
}
