# 四族戰紀（FactionWar）

獸人、精靈、矮人、人類四個陣營的小人自動發展、打造、建設、互相征戰的模擬遊戲。
目前為上帝觀察模式；設計文件見 [docs/DESIGN.md](docs/DESIGN.md)。

## 執行

```bash
npm install
npm run dev        # 開啟遊戲（網址會顯示在終端機）
npm test           # 單元測試
npm run balance    # 無畫面跑 100 場，統計各族勝率（可加參數：npm run balance -- 60 1）
```

## 已完成（M1 + M2）

- 四族各自的屬性（力量／敏捷／智慧／體質／魅力），個體在種族基礎值上隨機浮動
- 自動戰鬥：命中看敏捷、傷害看力量（近戰）或敏捷（遠程）、減傷看體質與護甲、士氣看魅力
- 經濟：採集木材／石材／鐵礦／漿果，農田、房屋、人口上限
- 科技：非戰鬥人員的智慧累積研究點數，書院加速；科技解鎖建築與裝備
- 打造：鐵匠智慧決定裝備品質（粗糙 → 大師之作），有種族專精與種族專屬武器
- 陣營 AI 透過指令佇列下達「訓練／建造／打造／進攻」（未來玩家指揮模式共用同一入口）
- 同一個種子可重播同一場戰局

## 程式結構

- `src/sim/` 純 TypeScript 模擬核心，不依賴畫面
  - `systems/` 移動（A*）、戰鬥、經濟、建造、打造、換裝
  - `ai/utility.ts` 個體決策（Utility AI 打分）；`ai/faction.ts` 陣營策略
- `src/render/` Canvas 繪圖；`src/ui/` React 面板
- `tools/balance.ts` 平衡模擬器

## 下一步

- M3 疾病與飢餓（`Unit.sick`、`hunger` 欄位已預留）
- M4 外交結盟與策反（`Faction.relations`、`Unit.loyalty`、`areHostile()` 已預留）
- M5 玩家指揮模式、開局設定
