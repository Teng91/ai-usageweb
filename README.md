# AI 用量（ai-usageweb）

一個打開就看得到 AI 服務本期還剩多少的 PWA：**Claude Pro、Codex（ChatGPT）、Antigravity、GitHub Copilot** 的額度，加上 **OpenRouter** 餘額。電腦、手機瀏覽器都能看，手機可以「加到主畫面」當 App。

部署在 fly.io：**有人打開才喚醒機器**，開著時每 60 秒更新並用 SSE 推到畫面上；沒人看幾分鐘後機器自動停掉，不計費。

- Node 22、零相依套件（`node:http`、內建 `fetch`、`node:crypto`、`node:test`）
- 前端是純 HTML＋CSS＋原生 JS，沒有打包
- 只讀不寫：只打各家「查用量」端點，不發模型請求

> ⚠ 除了 OpenRouter，其他四家用的都是官方工具自己在用的**內部端點**，隨時可能改，也可能牴觸服務條款。端點、欄位與 client id 都標為「需實測」，可以用環境變數覆寫（見 `.env.example`）。上線前請自己讀過各家條款。

## 架構

```
瀏覽器 ──GET /api/usage──▶ server.js ──▶ snapshot.js（記憶體＋/data/snapshot.json）
       ◀──SSE /api/stream──   │
                              ▼
                          poller.js（觀看者計數、每家排程、退避）
                              │ 有人看才跑，每 60 秒
                              ▼
         providers/{claude,codex,antigravity,copilot,openrouter}.js
                              │ 續期時
                              ▼
                credentials.js（環境變數＋AES-256-GCM 加密 volume）
```

| 路徑 | 說明 | 權限 |
| --- | --- | --- |
| `GET /` | PWA 頁面 | 公開 |
| `GET /api/usage` | 目前快照；也算「有人在看」 | 公開（或 `ACCESS_KEY`） |
| `GET /api/stream` | SSE：先送 `snapshot`，之後每家 `provider`；25 秒 `: ping` | 公開（或 `ACCESS_KEY`） |
| `GET /api/rankings` | OpenRouter 全站模型排行（每天／每週／每月，免費與付費各前 10 名，依 token 用量）；資料來自 OpenRouter 排行榜頁面的非官方端點，每小時最多抓一次 | 公開（或 `ACCESS_KEY`） |
| `GET /healthz` | 健康檢查，不觸發輪詢 | 公開 |
| `POST /admin/refresh` | 立刻重抓（仍受每家最短間隔限制） | `ADMIN_TOKEN` |
| `PUT /admin/credentials/:provider` | 替換某一家的憑證（JSON body） | `ADMIN_TOKEN` |
| `GET /admin/status` | 各家錯誤種類、下次抓取、token 到期時間（不含 token） | `ADMIN_TOKEN` |

錯誤處理：429 依 `Retry-After` 或 60→120→240→最多 900 秒退避（卡片保留舊數字並標「更新放慢」）；401 先續期再重試一次；續期失敗標「需要重新登入」並停止那一家；403／Cloudflare 這次觀看期間不再試；網路／5xx 退避最多 300 秒；格式變了每 300 秒試一次。

## 本機開發

需要 Node 22 以上。

```powershell
copy .env.example .env.local
```

在 `.env.local` 填入要測的憑證（例如先只填 `OPENROUTER_API_KEY`，並設 `PROVIDERS=openrouter`），然後：

```powershell
npm run dev
```

打開 http://localhost:8080 。測試：

```powershell
npm test
```

`test/fixtures/` 目前是依照規格欄位寫的**假資料**；拿到各家真實回傳（去掉 email、帳號 ID）後請替換掉。

## 各家憑證怎麼拿

**最重要的規則：伺服器用的 token 必須是獨立登入拿到的，不能跟你電腦上正在用的共用。** Claude 與 Codex 的 refresh token 每次續期都會換新、舊的立刻失效；共用的話伺服器一續期，你電腦上的 Claude Code／Codex 就會被登出。

| 服務 | 做法 | 環境變數 |
| --- | --- | --- |
| OpenRouter | 後台新建一把專用 key（可設額度上限 0）。`/credits` 被拒時會自動改查 `/key` | `OPENROUTER_API_KEY` |
| Copilot | `gh auth login` 後 `gh auth token`；不行就跑 Copilot 的 OAuth device flow 另拿一個 `gho_` token | `GITHUB_COPILOT_TOKEN` |
| Claude | 先試 `claude setup-token` 的長效 token 能不能打 usage 端點（填 `CLAUDE_OAUTH_TOKEN`）；不行就用獨立設定目錄登入（見下） | `CLAUDE_REFRESH_TOKEN` 等 |
| Codex | 獨立 `CODEX_HOME` 登入（見下） | `CODEX_REFRESH_TOKEN`、`CODEX_ACCOUNT_ID` 等 |
| Antigravity | 先用官方 `agy`（`winget install Google.AntigravityCLI`）以 Google 帳號登入一次，再跑 `scripts\setup-antigravity.ps1`（見下） | `ANTIGRAVITY_*` |

Claude 獨立登入（PowerShell），開起來後在 Claude Code 裡輸入 `/login`：

```powershell
$env:CLAUDE_CONFIG_DIR="$PWD\server-claude"; claude
```

Codex 獨立登入：

```powershell
$env:CODEX_HOME="$PWD\server-codex"; codex login
```

Antigravity 比較特別，不用獨立資料夾，而是用官方 CLI 登入後直接讀它存的憑證：

```powershell
winget install Google.AntigravityCLI
```

裝好後執行 `agy`（不帶參數），選「Google OAuth」用你的 Google 帳號登入一次。接著在專案資料夾跑這個腳本，它會從認證管理員讀出 refresh token、比對出對應的 OAuth client，並直接設到 fly（token 不會印出來）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-antigravity.ps1
```

全部登入完，產生 `fly secrets set` 指令（含新的 `CREDENTIALS_KEY` 與 `ADMIN_TOKEN`）：

```powershell
node scripts/extract-credentials.js --gen-keys --gh
```

`server-*` 目錄與 `server-antigravity.json` 已在 `.gitignore`，用完就刪掉。

## 部署到 fly.io

```powershell
fly auth login
```

```powershell
fly launch --no-deploy --copy-config --name ai-usageweb --region sin
```

```powershell
fly volumes create usage_data --size 1 --region sin
```

把上面 `extract-credentials.js` 印出的 `fly secrets set ...` 貼上執行，然後：

```powershell
fly deploy
```

打開 `https://ai-usageweb.fly.dev`，`fly logs` 會看到每家一行 JSON 抓取紀錄。關掉網頁等 5–10 分鐘，`fly machine list` 應該是 `stopped`。

自動部署：`fly tokens create deploy` 產生 token，存成 GitHub repo secret `FLY_API_TOKEN`，之後推到 `main` 會先跑 `npm test` 再 `fly deploy`。

### 憑證的保存與重設

- 初始值來自 fly secrets；續期後的新值寫進 volume `/data/credentials.enc`（AES-256-GCM，金鑰是 `CREDENTIALS_KEY`），先寫成功才使用。
- 讀取優先順序：volume ＞ 環境變數，所以重新部署不會把已輪換的 token 蓋回舊的。
- 要強制用新的 secret：同時設 `CREDENTIALS_RESET=claude,codex`（部署後記得拿掉），或用管理 API：

```powershell
curl.exe -X PUT https://ai-usageweb.fly.dev/admin/credentials/claude -H "Authorization: Bearer $env:ADMIN_TOKEN" -H "Content-Type: application/json" -d '{\"accessToken\":\"...\",\"refreshToken\":\"...\",\"expiresAt\":0}'
```

### 不想完全公開

設 `ACCESS_KEY`，第一次用 `https://ai-usageweb.fly.dev/?k=<ACCESS_KEY>` 打開，之後記在 cookie。

## 加到主畫面

- iPhone：Safari → 分享 → 加入主畫面
- Android：Chrome 會跳安裝提示，或點頁面右上的「安裝」

離線時會顯示上次的數字並標示「離線」。部署新版後頁面頂端會出現「有新版本，點此重新載入」（改前端檔案時記得把 `public/sw.js` 的 `CACHE` 版本號 +1）。

## 專案結構

```
server.js                 HTTP、SSE、靜態檔、管理 API
src/poller.js             觀看者計數、每家排程、退避、共用 in-flight Promise
src/snapshot.js           記憶體快照、/data/snapshot.json 原子寫入
src/credentials.js        環境變數＋加密 volume、每家續期鎖
src/sse.js                SSE 連線、ping、廣播、連線上限 30 分鐘
src/http.js               對外請求、錯誤分類、Cloudflare 偵測
src/providers/*.js        五家 adapter（統一輸出 { plan, windows, balance, note }）
public/                   PWA（index.html、app.js、style.css、sw.js、manifest、icons）
scripts/                  extract-credentials.js、antigravity-login.js
test/                     node:test＋假 fetch＋fixtures
```
