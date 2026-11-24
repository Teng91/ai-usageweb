# AGENTS.md — 給 AI 助手的專案規則

## 專案
ai-usageweb：顯示 Claude、Codex、Antigravity、Copilot 額度與 OpenRouter 餘額的 PWA，部署在 fly.io，有人看才輪詢。

## 規則
- **不加相依套件**。只用 Node 22 內建模組；前端是原生 JS，不打包、不用框架。
- **絕不在 log、錯誤訊息、API 回應裡出現 token、完整 header 或原始回應。** 錯誤只留服務名、狀態碼、簡短中文說明。
- 公開 API 只回傳百分比、剩餘量、重置時間；不回傳 email、帳號 ID、組織名。
- repo 是公開的：不要提交 `.env*`、`server-*`、`*.enc`、`data/`。
- 每家 adapter 輸出統一格式 `{ plan, planExpiresAt?, windows: [{ id, label, usedPct, resetsAt, used?, limit? }], balance, note }`；`usedPct` 一律是「已用」0–100。前端只認這個格式。
- 續期拿到新 refresh token 時：**先 `await saveCreds()` 成功才使用**；續期包在 `withLock` 裡。
- 對各家的請求不論幾個人在看都不超過每家每 `minIntervalSec` 一次；不要新增公開的「立刻重抓」。
- `/healthz` 不能算「有人在看」。
- 改了 `public/` 的檔案要把 `public/sw.js` 的 `CACHE` 版本號 +1。
- 改 adapter 時一併更新 `test/fixtures/` 與 `test/providers.test.js`，`npm test` 必須通過。
- 介面文字用繁體中文。
