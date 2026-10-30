import { useEffect, useState } from 'react';
import { DIFFICULTIES } from '../sim/kingdom';
import { hasSea } from '../sim/sea';
import { possessedHero } from '../sim/systems/heroSystem';
import type { Difficulty, Faction, World } from '../sim/types';
import { formatTime } from './ControlBar';
import type { SaveMeta } from './saveGame';

const TUTORIAL_KEY = 'factionwar.tutorial';
const WELCOMED_KEY = 'factionwar.welcomed';

interface TutorialState {
  off: boolean;
  done: string[];
}

function loadTutorial(): TutorialState {
  try {
    const raw = localStorage.getItem(TUTORIAL_KEY);
    return raw ? { off: false, done: [], ...JSON.parse(raw) } : { off: false, done: [] };
  } catch {
    return { off: false, done: [] };
  }
}

function saveTutorial(t: TutorialState): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify(t));
  } catch {
    // 無痕模式時不記錄
  }
}

export function tutorialEnabled(): boolean {
  return !loadTutorial().off;
}

/** 開啟時從頭再教一次；關閉時不再出現提示 */
export function setTutorialEnabled(on: boolean): void {
  saveTutorial({ off: !on, done: [] });
}

export function hasBeenWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    // 無痕模式時下次還會再歡迎一次
  }
}

interface Step {
  id: string;
  title: string;
  text: string;
  /** 這一步什麼時候出現 */
  when: (world: World, me: Faction) => boolean;
  /** 玩家照做了就自動完成（沒有的話按「知道了」） */
  done?: (world: World, me: Faction) => boolean;
  /** 要發光提示的按鈕 */
  target?: string;
}

const warriors = (world: World, me: Faction) =>
  world.units.filter((u) => u.hp > 0 && u.factionId === me.id && u.role === 'warrior').length;

const STEPS: Step[] = [
  {
    id: 'king',
    title: '👑 你是國王',
    text: '採集、蓋房子、訓練士兵、打造武器都由大臣（AI）自動處理，你只要決定大方向。金框裡就是你的指揮列。遊戲會自動存檔，關掉網頁下次可以繼續。',
    when: () => true,
    target: '.kingdom-bar',
  },
  {
    id: 'fog',
    title: '🌫 戰爭迷霧',
    text: '暗掉的地方是你看不到的。🔭 斥候會自動四處偵察；📍 偵察可以指定斥候去哪裡看。',
    when: (world) => !!world.fog,
    target: '[data-coach="scout"]',
  },
  {
    id: 'outpost',
    title: '🚩 佔領據點',
    text: '地圖上的礦場、瞭望塔、戰神祠可以佔領：按「派兵佔領」派 3 名戰士過去，佔下來就有額外資源、視野或戰力。',
    when: (world) => world.outposts.length > 0,
    done: (_world, me) => Object.values(me.garrisons).some((n) => n > 0),
    target: '[data-coach="outpost"]',
  },
  {
    id: 'attack',
    title: '⚔ 出兵進攻',
    text: '開局 🛡 防守，讓大臣一邊發展一邊守家。兵力夠了就按「進攻」，全軍會殺向敵方營帳；打不過隨時按 🛡 防守撤回。攻陷對方營帳就勝利！',
    when: (world, me) => warriors(world, me) >= 10 || world.tick > 3 * 60 * 10,
    done: (_world, me) => me.stance === 'attack',
    target: '[data-coach="attack"]',
  },
  {
    id: 'tactics',
    title: '🎺 戰術',
    text: '戰術列可以設定什麼時候撤退、優先打誰。🎺 衝鋒、🛡 盾牆、🔔 召回是有冷卻的戰術指令，在兩軍交戰的關鍵時刻按下去。',
    when: (_world, me) => me.stance === 'attack',
    target: '.kb-tactics',
  },
  {
    id: 'hero',
    title: '⭐ 英雄出現了',
    text: '身經百戰的士兵會成為英雄。在「英雄」列表點他，再按 👁 附身就能親自上陣：點地圖移動、點敵人攻擊、放技能（鍵盤 Q／W／E），按「解除」回到國王視角。',
    when: (world, me) => world.units.some((u) => u.hp > 0 && u.factionId === me.id && !!u.hero),
    done: (world) => !!possessedHero(world),
  },
  {
    id: 'navy',
    title: '🌊 三國鼎立',
    text: '版圖擴張了！海的另一邊有兩個新王國，兩個都打下來就統一天下。大臣會在海邊蓋碼頭；造 ⛵ 運兵船並開啟 ⚓ 登陸，進攻時就會渡海搶灘、水陸夾擊。',
    when: (world) => hasSea(world),
    target: '.kb-navy',
  },
];

/** 王國模式的新手提示：照遊戲進度一步一步出現，照做或按「知道了」就換下一步 */
export function Coach({ world }: { world: World }) {
  const [state, setState] = useState(loadTutorial);
  const k = world.kingdom;
  const me = k ? world.factions[k.player] : null;
  const update = (next: TutorialState) => {
    setState(next);
    saveTutorial(next);
  };

  let step: Step | null = null;
  const autoDone: string[] = [];
  if (k && me && me.alive && !world.over && !state.off) {
    for (const s of STEPS) {
      if (state.done.includes(s.id) || !s.when(world, me)) continue;
      if (s.done?.(world, me)) {
        autoDone.push(s.id);
        continue;
      }
      step = s;
      break;
    }
  }

  useEffect(() => {
    if (autoDone.length) update({ ...state, done: [...state.done, ...autoDone] });
  });

  // 讓要按的按鈕發光（指揮列每次重畫後重新加上）
  useEffect(() => {
    if (!step?.target) return;
    const els = [...document.querySelectorAll(step.target)].slice(0, 1);
    els.forEach((el) => el.classList.add('coach-glow'));
    return () => els.forEach((el) => el.classList.remove('coach-glow'));
  });

  if (!step) return null;
  const n = STEPS.indexOf(step) + 1;
  return (
    <div className="coach" role="status">
      <div className="coach-head">
        <b>{step.title}</b>
        <span className="muted">
          新手提示 {n}/{STEPS.length}
        </span>
      </div>
      <p>{step.text}</p>
      <div className="coach-actions">
        <button className="primary" onClick={() => update({ ...state, done: [...state.done, step!.id] })}>
          知道了
        </button>
        <button onClick={() => update({ ...state, off: true })}>關閉提示</button>
      </div>
    </div>
  );
}

interface WelcomeProps {
  saved: SaveMeta | null;
  onResume: () => void;
  onKingdom: () => void;
  onClose: () => void;
}

const savedAtText = (t: number) =>
  new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 開場：第一次來的人看玩法介紹；有存檔就可以繼續上一局 */
export function WelcomePanel({ saved, onResume, onKingdom, onClose }: WelcomeProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel welcome" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>⚔ 四族戰紀</h2>
          <button onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        {saved && (
          <div className="welcome-save">
            <div>
              <b>📜 繼續上一局</b>
              <div className="muted">
                {saved.title} · {saved.chapter === 2 ? '第二章' : '第一章'} ·{' '}
                {DIFFICULTIES[saved.difficulty as Difficulty]?.name} · ⏱ {formatTime(saved.tick)}
              </div>
              <small className="muted">存於 {savedAtText(saved.savedAt)}</small>
            </div>
            <button className="primary" onClick={onResume}>
              ▶ 繼續
            </button>
          </div>
        )}
        <p>六個種族的小人會自己採集、蓋房子、打造武器、生病、結盟，然後開戰。你可以選擇：</p>
        <div className="welcome-modes">
          <button className="welcome-mode" onClick={onKingdom}>
            <span className="welcome-icon">👑</span>
            <b>王國模式</b>
            <span className="tag">推薦新手</span>
            <span className="muted">選一個王國當國王，指揮大軍、選國策、附身英雄，在 1v1 地圖上擊敗對手，之後還能擴張版圖、渡海作戰。</span>
          </button>
          <button className="welcome-mode" onClick={onClose}>
            <span className="welcome-icon">🌍</span>
            <b>上帝模式</b>
            <span className="muted">
              背景這一局就是：四族自動混戰，你用上方的神力（天雷、瘟疫、祝福、援軍……）介入，或點小人、建築看他們在做什麼。
            </span>
          </button>
        </div>
        <p className="muted welcome-tips">
          操作：點擊查看詳情 · 拖曳移動地圖 · 滾輪或雙指縮放 · 空白鍵暫停 · 上方可以調整速度。之後隨時可以按上方的「❓」再看一次。
        </p>
      </div>
    </div>
  );
}
