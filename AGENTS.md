# AGENTS.md — 給 AI 助手的專案規則

## 專案
ai-usageweb：顯示 Claude、Codex、Antigravity 額度與 OpenRouter 餘額的 PWA，部署在 fly.io，有人看才輪詢（每 2 分鐘），沒人看機器自動 suspend。另外有 OpenRouter 模型排行（`src/rankings.js`）。

## 規則
- **不加相依套件**。只用 Node 內建模組（Node 22 以上都要能跑；部署與 CI 用 Node 24）；前端是原生 JS（ES modules），不打包、不用框架。
- **絕不在 log、錯誤訊息、API 回應裡出現 token、完整 header 或原始回應。** 錯誤只留服務名、狀態碼、簡短中文說明。
- 公開 API 只回傳百分比、剩餘量、重置時間（與由這些算出的預估用完時間）；不回傳 email、帳號 ID、組織名。排行也一樣只存公開資料。
- repo 是公開的：不要提交 `.env*`、`server-*`、`*.enc`、`data/`。
- 每家 adapter 輸出統一格式 `{ plan, planExpiresAt?, windows: [{ id, label, usedPct, resetsAt, periodSec? }], balance, note }`；`usedPct` 一律是「已用」0–100。前端只認這個格式。`periodSec` 是窗口長度（秒），推播靠它分辨週／月額度、前端靠它畫時間進度，知道就要填。`exhaustsAt`（預估用完時間）不是 adapter 給的，是 poller 經 `src/forecast.js` 加上去的。
- 每家 adapter 要宣告 `credentialFields`（管理 API 換憑證時接受的欄位）；憑證多了新欄位就加進去。刪掉一家時連同 `credentials.js` 的環境變數、`config.js` 的端點、fixture 與測試一起刪；volume 裡那家的舊憑證會在啟動時自動清掉。
- 續期拿到新 refresh token 時：**先 `await saveCreds()` 成功才使用**；續期包在 `withLock` 裡。
- 對各家的請求不論幾個人在看都不超過每家每 `minIntervalSec` 一次；不要新增公開的「立刻重抓」。OpenRouter 排行最多每小時抓一次。
- 手動設定的值（`CLAUDE_PLAN`、`CLAUDE_PLAN_EXPIRES_AT`）透過 `config.js` 的 `manual` 每次直接讀環境變數，不要放進憑證：volume 裡的憑證會蓋過環境變數。
- 環境變數只在 `src/config.js` 讀（各家端點覆寫在 `endpoints`），adapter 不直接讀 `process.env`。
- 卡片順序只在 `src/providers/index.js` 定義，前端照快照順序；不要在前端再寫一份。
- `/healthz` 與 `/api/push/tick` 不能算「有人在看」。
- 推播：規則在 `src/alerts.js`（純函式）、判斷與發送在 `src/push.js`、訂閱、設定、樣本與已發紀錄的存檔在 `src/push-store.js`（`push.js` 只透過它的方法讀寫，不直接碰 `state`）、API 在 `src/push-routes.js`、加密在 `src/webpush.js`、時間寫法在 `src/time.js`。推播內容只放百分比與重置時間。改規則要更新 `test/push.test.js` 與 README 的規則表。之後要做的事記在 `docs/TODO.md`。
- 推播的排程喚醒主要靠 Google Apps Script（`google_apps_script/Code.gs`，repo 裡只是副本），GitHub Actions 的 `push-tick.yml` 是備援。前端不保存推播密碼。
- 存檔格式（例如 `rankings.json`）改了欄位就把該檔的 `FORMAT_VERSION` +1，讓舊檔被丟掉。例外：`push.json`（版本在 `push-store.js`） 只新增選填欄位（例如 `settings`）時不要升版本，升了會把訂閱一起丟掉，手機要重新開啟通知。

## 前端
- 改了 `public/` 的檔案要把 `public/sw.js` 的 `CACHE` 版本號 +1；新增要離線可用的檔案要加進 `SHELL`。新的 `/api/*` 不經 service worker（加進 `sw.js` 的略過清單）；`/api/usage`、`/api/rankings` 走 network-first，離線時給上次存下的；前端要讀上次存下的就帶 `x-cache-only` 標頭請求，不要在前端直接開 Cache Storage（快取名稱只寫在 `sw.js`）。
- 前端模組分工：`app.js` 資料與連線、`ui/cards.js` 卡片與頂列、`ui/rankings.js` 排行、`ui/effects.js` 冒險風格效果、`ui/theme-toggle.js` 亮暗與風格切換、`ui/pwa.js` 離線／安裝、`ui/push.js` 通知設定、`ui/format.js` 格式化、`ui/dom.js` 共用的取元素函式、狀態、localStorage 與裝置判斷（`isIos`、`isStandalone`）。不要再把東西塞回 `app.js`。`public/theme.js` 是畫面出現前套用主題的小腳本（非模組），跟 `ui/theme-toggle.js` 不同。
- CSP 不允許內嵌 script 與 HTML 裡的 `style=""`；要動態樣式用 JS 設 `element.style`。
- 兩種風格：簡約（`style.css`）與冒險（`skin-adventure.css` 卡片、按鈕與遊戲介面；`scene.css` 場景）。冒險風格的規則一律限定在 `[data-skin="adventure"]` 底下，不能影響簡約風格。
- 冒險風格的場景：地圖資料在 `public/scene-maps.js`，邏輯在 `public/scene.js`。平台與天上的怪物只放卡片兩側（`side: true`），不要放在會被卡片擋住的地方。
- **像素圖只用原創點陣**，由 `scripts/gen-pixel-art.mjs` 產生到 `public/pixel/`（角色在 `scripts/pixel-art/characters.mjs`、場景在 `scenery.mjs`；改點陣再執行，不要手改 svg）。**不要仿製任何既有遊戲的角色、Logo 或美術**，使用者要求也一樣。
- 改了前端要跑 `npm run test:ui`（需要本機 Chrome／Edge）；新增畫面行為時在 `scripts/smoke-ui.mjs` 補一項檢查。
- 用 Node 腳本改檔案時，`String.replace` 的取代字串裡 `$` 有特殊意義（`` $` `` 會插入比對前的整段文字），含 `$` 的內容改用 `split().join()` 或直接寫檔。

## 測試
- 後端分工：`server.js` 只組裝、`src/routes.js` 路由、`src/static.js` 靜態檔、`src/respond.js` 回應小工具。新 API 加在 `routes.js`（推播的加在 `push-routes.js`）。
- 推到 `main` 會跑 `npm test` 與 `npm run test:ui`，兩個都過才部署。
- 改 adapter 時一併更新 `test/fixtures/` 與 `test/providers.test.js`，`npm test` 必須通過（自動部署前也會跑）。
- 介面文字用繁體中文。
