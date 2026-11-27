# AI 用量（ai-usageweb）

一個打開就看得到 AI 服務本期還剩多少的 PWA：**Claude Pro、Codex（ChatGPT）、Antigravity（卡片名稱是 Gemini）** 的額度，加上 **OpenRouter** 餘額與全站熱門模型。電腦、手機瀏覽器都能看，手機可以「加到主畫面」當 App。

部署在 fly.io：**有人打開才喚醒機器**，開著時每 2 分鐘更新並用 SSE 推到畫面上；沒人看幾分鐘後機器自動暫停（suspend，下次喚醒只要幾百毫秒），不收 CPU／記憶體費用。

- Node 22 以上（部署用 Node 24 LTS）、零相依套件（`node:http`、內建 `fetch`、`node:crypto`、`node:zlib`、`node:test`）
- 前端是純 HTML＋CSS＋原生 JS，沒有打包
- 只讀不寫：只打各家「查用量」端點，不發模型請求

架構、設計取捨、測試與遇到的問題整理在 [docs/TECHNICAL.md](docs/TECHNICAL.md)。

> ⚠ 除了 OpenRouter，其他三家用的都是官方工具自己在用的**內部端點**，隨時可能改，也可能牴觸服務條款。端點、欄位與 client id 都標為「需實測」，可以用環境變數覆寫（見 `.env.example`）。上線前請自己讀過各家條款。

## 架構

```
瀏覽器 ──GET /api/usage──▶ server.js（組裝）──▶ routes.js ──▶ snapshot.js（記憶體＋/data/snapshot.json）
       ◀──SSE /api/stream──   （sse.js）          │  ├─▶ rankings.js（OpenRouter 排行，/data/rankings.json）
                                                  │  ├─▶ push-routes.js（推播 API）
                                                  │  └─▶ static.js（public/，br／gzip、ETag）
                                                  ▼
                               poller.js（觀看者計數、每家排程、退避）──▶ forecast.js（預估用完時間）
                                                  │ 有人看才跑，每 2 分鐘
                                                  ▼
                         providers/{claude,codex,antigravity,openrouter}.js
                                                  │ 續期時
                                                  ▼
                               credentials.js（環境變數＋AES-256-GCM 加密 volume）

抓到新資料 ──▶ push.js（alerts.js 判斷；樣本與紀錄在 push-store.js）──▶ webpush.js ──▶ 手機
Google Apps Script 每 15 分鐘 ──POST /api/push/tick──▶ 機器沒人看時也會抓一輪並判斷
（GitHub Actions 的排程當備援，常延遲好幾小時）
```

| 路徑 | 說明 | 權限 |
| --- | --- | --- |
| `GET /` | PWA 頁面 | 公開 |
| `GET /api/usage` | 目前快照；也算「有人在看」 | 公開（或 `ACCESS_KEY`） |
| `GET /api/stream` | SSE：先送 `snapshot` 與 `ping`（帶間隔秒數），之後每家 `provider`；每 25 秒一次 `ping` 事件，前端連續 3 次沒收到就重連 | 公開（或 `ACCESS_KEY`） |
| `GET /api/rankings` | OpenRouter 全站模型排行（每天／每週／每月，免費與付費各前 10 名，依 token 用量；付費附每百萬 token 輸入／輸出價格）；資料來自 OpenRouter 排行榜頁面的非官方端點，每小時最多抓一次；還沒有資料時回 503 | 公開（或 `ACCESS_KEY`） |
| `GET /healthz` | 健康檢查，不觸發輪詢 | 公開 |
| `GET /api/push/config` | 推播是否啟用與 VAPID 公鑰 | 公開（或 `ACCESS_KEY`） |
| `POST /api/push/subscribe` | 新增訂閱（body：`subscription`、`prefs`） | `PUSH_KEY` |
| `POST /api/push/status`、`/prefs`、`/settings`、`/unsubscribe`、`/test` | 查狀態（已訂閱時附上設定）、改通知種類（body 加 `prefs`）、改勿擾時段與週／月門檻（body 加 `settings`）、退訂、送測試通知（body：`endpoint`；測試 30 秒一次） | 已訂閱、知道自己的 endpoint |
| `POST /api/push/tick` | 排程喚醒：各家抓一輪並判斷推播，不算「有人在看」 | `PUSH_TICK_TOKEN` |
| `POST /admin/refresh` | 立刻重抓（仍受每家最短間隔限制） | `ADMIN_TOKEN` |
| `PUT /admin/credentials/:provider` | 替換某一家的憑證（JSON body，只收該家認得的欄位） | `ADMIN_TOKEN` |
| `GET /admin/status` | 各家錯誤種類、下次抓取、token 到期時間（不含 token） | `ADMIN_TOKEN` |

SSE 被擋時（例如公司 proxy 會卡住串流），前端 6 秒內沒連上就改成每 30 秒輪詢 `/api/usage`，右上角顯示「自動更新」；SSE 斷線後重連被拒（例如機器重啟中回 502／503）也馬上改輪詢。

切到別的視窗太久，伺服器會停；切回來時資料比一個更新週期舊，卡片先標「更新中」，前端每隔幾秒再問一次，新數字幾秒內就到，不必按 F5。

同時最多 20 條 SSE 連線（`SSE_MAX_CLIENTS`），滿了回 503，前端一樣改用輪詢。

Cloudflare 判斷只看 HTML 挑戰頁或 `cf-mitigated` 標頭；一般 JSON 的 403 照「403 沒有權限」處理。

錯誤處理：429 依 `Retry-After` 或 240→480→最多 900 秒退避（卡片保留舊數字並標「被限流，更新放慢（N 分鐘後重試）」，等退避的期間不算過期）；401 先續期再重試一次；續期失敗標「需要重新登入」並停止那一家；403／Cloudflare 這次觀看期間不再試；網路／5xx 退避最多 300 秒；格式變了每 300 秒試一次。出錯的卡片會在錯誤後面寫下次重試的倒數（依快照的 `nextFetchAt`；要重新登入、被擋的不會照時間重試，就不寫）。

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

前端 smoke test（用假資料起本機伺服器，開本機的 Chrome／Edge 實際操作畫面：卡片、排行、亮暗與風格切換、四季地圖、只看風景、手機版）。需要本機有 Chrome 或 Edge，或設 `CHROME_PATH`：

```powershell
npm run test:ui
```

`test/fixtures/` 是各家回傳的樣本（欄位跟實際回傳一樣，不含 email、帳號 ID、組織名）；端點或欄位改了，把新的回傳去掉帳號資訊後換上，並讓 `npm test` 通過。

## 各家憑證怎麼拿

**最重要的規則：伺服器用的 token 必須是獨立登入拿到的，不能跟你電腦上正在用的共用。** Claude 與 Codex 的 refresh token 每次續期都會換新、舊的立刻失效；共用的話伺服器一續期，你電腦上的 Claude Code／Codex 就會被登出。

| 服務 | 做法 | 環境變數 |
| --- | --- | --- |
| OpenRouter | 後台新建一把專用 key（可設額度上限 0）。`/credits` 被拒時會自動改查 `/key` | `OPENROUTER_API_KEY` |
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

`server-*` 目錄已在 `.gitignore`，用完就刪掉。

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

打開 `https://ai-usageweb.fly.dev`，`fly logs` 會看到每家一行 JSON 抓取紀錄（續期成功會多一行「憑證已續期並寫入」）。關掉網頁等 5–10 分鐘，`fly machine list` 應該是 `suspended`；部署或主機搬移後的第一次喚醒仍是一般冷啟動。

自動部署：`fly tokens create deploy` 產生 token，存成 GitHub repo secret `FLY_API_TOKEN`，之後推到 `main` 會先跑 `npm test` 與前端 smoke test（`npm run test:ui`，用 runner 內建的 Chrome），兩個都過才 `fly deploy`。GitHub Actions 釘在固定的 commit，Dependabot（`.github/dependabot.yml`）每週檢查新版，有的話開 PR，合併後才會用到。

### 憑證的保存與重設

- 初始值來自 fly secrets；續期後的新值寫進 volume `/data/credentials.enc`（AES-256-GCM，金鑰是 `CREDENTIALS_KEY`），先寫成功才使用。
- 讀取優先順序：volume ＞ 環境變數，所以重新部署不會把已輪換的 token 蓋回舊的。
- 要強制用新的 secret：同時設 `CREDENTIALS_RESET=claude,codex`（部署後記得拿掉），或用管理 API：

```powershell
curl.exe -X PUT https://ai-usageweb.fly.dev/admin/credentials/claude -H "Authorization: Bearer $env:ADMIN_TOKEN" -H "Content-Type: application/json" -d '{\"accessToken\":\"...\",\"refreshToken\":\"...\",\"expiresAt\":0}'
```

管理 API 只收各家認得的欄位，打錯名稱（例如 `refresh_token`）或少了必要欄位會回 400 並列出可用欄位，原本的憑證不會被動到：

| 服務 | 欄位（粗體是必要的） |
| --- | --- |
| `claude` | **`accessToken` 或 `refreshToken`**、`expiresAt` |
| `codex` | **`accessToken` 或 `refreshToken`**、`expiresAt`、`accountId` |
| `antigravity` | **`refreshToken`、`clientId`、`clientSecret`**、`projectId` |
| `openrouter` | **`apiKey`** |

- 關機（例如部署）時會等正在跑的抓取結束才退出（最多 12 秒，`fly.toml` 的 `kill_timeout` 是 15 秒），續期拿到的新 refresh token 一定會先寫進 volume。
- 沒設 `CREDENTIALS_KEY` 時續期後的 token 只存在記憶體，log 會寫「只存在記憶體」提醒。

### 不想完全公開

設 `ACCESS_KEY`，第一次用 `https://ai-usageweb.fly.dev/?k=<ACCESS_KEY>` 打開，之後記在 cookie（HttpOnly）；載入成功後網址上的 `?k=` 會自動拿掉，不會留在瀏覽紀錄。

### 環境變數一覽

各家的憑證（`OPENROUTER_API_KEY`、`CLAUDE_*`、`CODEX_*`、`ANTIGRAVITY_*`）見上面的「各家憑證怎麼拿」；其他的都列在這裡，全部集中在 `src/config.js` 讀取。

**安全與存取**

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `CREDENTIALS_KEY` | 無 | 32 bytes 的 base64，加密 volume 裡的憑證；沒設的話續期後的 token 只存在記憶體 |
| `ADMIN_TOKEN` | 無 | 管理 API（`/admin/*`）的 Bearer token；沒設就不開放 |
| `CREDENTIALS_RESET` | 無 | 用環境變數強制重設某幾家的憑證，例如 `claude,codex`（部署後記得拿掉） |
| `ACCESS_KEY` | 無 | 設了之後資料 API 要用 `?k=` 開過一次才看得到（見「不想完全公開」） |

**推播**（`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`PUSH_KEY` 都設才啟用，用 `npm run gen-vapid` 產生）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` | 無 | Web Push 的金鑰 |
| `VAPID_SUBJECT` | `https://ai-usageweb.fly.dev` | 推播服務聯絡用的網址（VAPID 規格要求） |
| `PUSH_KEY` | 無 | 在網頁上開啟通知時要輸入的密碼 |
| `PUSH_TICK_TOKEN` | 無 | 排程喚醒 `POST /api/push/tick` 的 token（Apps Script、GitHub Actions 用同一個） |
| `PUSH_TZ` | `Asia/Taipei` | 推播判斷勿擾與寫時間用的時區 |
| `PUSH_QUIET` | `00-08` | 勿擾時段（當地整點，`off` 代表不設）；網頁上改過就以網頁的為準 |

**執行**（都有預設值，通常不必設）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 埠 |
| `DATA_DIR` | `./data`（fly 上是 `/data`） | 快照、加密憑證、排行、推播的存檔位置 |
| `POLL_INTERVAL_SEC` | `120` | 有人看時每家多久抓一次（Claude 約每 2 分鐘才給查一次，不建議調低） |
| `IDLE_GRACE_SEC` | `90` | 觀看者全部離開後再等多久才停止輪詢 |
| `REQUEST_TIMEOUT_MS` | `10000` | 對各家請求的逾時 |
| `SSE_MAX_AGE_SEC` | `1800` | 單一 SSE 連線最長多久，到了請前端在看得見時重連 |
| `SSE_PING_SEC` | `25` | SSE 多久送一次 `ping` 事件 |
| `SSE_MAX_CLIENTS` | `20` | 同時最多幾條 SSE 連線，滿了回 503（前端改輪詢） |
| `PROVIDERS` | 全部 | 只開部分服務，例如 `claude,openrouter` |

**手動設定**（API 拿不到）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `CLAUDE_PLAN` | `Pro` | Claude 卡片顯示的方案名稱 |
| `CLAUDE_PLAN_EXPIRES_AT` | 無 | Claude 訂閱到期日 `YYYY-MM-DD` |

`CLAUDE_PLAN`、`CLAUDE_PLAN_EXPIRES_AT` 每次都直接讀環境變數、不會存進憑證，改 fly secrets 就會生效。各家端點與 client id 的覆寫（內部端點常變）列在 `.env.example` 最後面。

## 手機通知（Web Push）

額度快用完、或週／月額度快重置卻還剩很多時，推播到手機。不設定就不會出現鈴鐺按鈕。

1. 產生金鑰與密碼，照印出來的指令設到 fly：

   ```powershell
   npm run gen-vapid
   ```

2. 設定排程喚醒，讓沒開網頁時也能判斷。主要用 **Google Apps Script**（準時，誤差通常在幾分鐘內）：
   1. 到 [script.google.com](https://script.google.com) 建立專案，把 `google_apps_script/Code.gs` 整個貼上；網址不是 `https://ai-usageweb.fly.dev` 的話改開頭的 `APP_URL`。
   2. **專案設定 → 指令碼屬性**，新增 `PUSH_TICK_TOKEN`（跟 fly secrets 的同一個值）。
   3. 手動執行一次 `tick`（第一次會要求授權），在「執行項目」看到 `{"ok":true,"sent":0}` 就是通了。
   4. 執行 `installTrigger`：建立每 15 分鐘一次的觸發器（可以重複執行，會先清掉舊的）。

   備援是 GitHub Actions 的 `.github/workflows/push-tick.yml`（GitHub repo 的 Settings → Secrets and variables → Actions 新增 secret `PUSH_TICK_TOKEN`；網址不同再設 variable `APP_URL`）。GitHub 的排程常常延遲好幾小時、尖峰時段甚至整次跳過，只靠它推播會很不準；跟 Apps Script 同時跑不會重複推播（伺服器會去重、也有每家最短抓取間隔）。它每天也會呼叫 GitHub API 重新啟用自己，避免 repo 60 天沒 commit 時排程被停用。
3. 手機打開網站（iPhone 要先「加入主畫面」，再從主畫面打開），點頂列的鈴鐺，輸入 `PUSH_KEY`、開啟通知，按「送測試通知」確認收得到。推播密碼只在開啟時用一次，不會存在瀏覽器裡；之後改通知種類、關閉都不用再輸入，關掉再重新開啟時才要再輸入。

通知規則：

| 類型 | 什麼時候發 |
| --- | --- |
| 用量警告 | 已用 ≥ 50%，且照最近 90 分鐘的速度會在重置前用完；週／月額度另外在 80%、90% 各一次（不看速度）；已用 95% 一定發。同一個重置週期各一次 |
| 快重置還有剩 | 只看週／月額度，而且最近一小時沒在用：24 小時內剩 ≥ 40%、12 小時內剩 ≥ 20%、6 小時內剩 ≥ 10% 各一次 |
| 額度重置了 | 上一輪用到 ≥ 90%、重置後用量 ≤ 50%：通知一次「可以繼續用了」。5 小時這種短週期只在重置後 2 小時內發，週／月 12 小時內（勿擾時段重置的，勿擾結束後補發） |

- 00:00–08:00 不發（時區 `PUSH_TZ`）；「快重置」會落在勿擾時段的提醒，提前到勿擾開始前 2 小時內發。
- **勿擾時段和週／月門檻可以在網頁上改**：開啟通知後，通知設定對話框會多出「勿擾時段」（開始、結束各選一個整點，或關掉）和「週／月額度提醒」（兩個門檻，可選 50%–90% 或關閉；95% 一定會發，不用設）。設定全站共用、存在 `/data/push.json`；沒改過時勿擾用 `PUSH_QUIET`、門檻是 80%／90%。
- 網頁開著時先不推播、也不記成已發，關掉網頁後條件還成立就照樣推播（電腦開著分頁、人不在時手機也收得到）。「開著」是 SSE 連著、或最近 90 秒內有輪詢（在公司 SSE 被擋、走輪詢時也算）；同一類合成一則，新的蓋掉舊的；每家每天最多 4 則（超過上限或送失敗的不算發過，之後還會再判斷）。
- 機器每 15 分鐘被叫醒一次（Apps Script 不保證固定在哪一分鐘）、抓完約幾分鐘後又 suspend，執行時間大約多三分之一，費用每月不到 1 美元。

## 畫面

- **卡片分兩區**：上面四張卡片（Claude、Gemini、Codex、OpenRouter 餘額），下面一整列 OpenRouter 熱門模型（免費／付費），不加標題。
- **每張卡片的額度**：
  - Claude：5 小時、每週（有的話再加每週 Opus／Sonnet）
  - Gemini（Antigravity）：跟 Claude 一樣「5 小時」「每週」兩條，只算 Gemini 模型。Antigravity 附送的 Claude/GPT 額度很小（一下就用完、每週大約只有兩個 5 小時），不顯示也不推播；要看的話把 `src/providers/antigravity.js` 的 `SHOWN` 加回 `claude_gpt`。免費方案只有模型清單給的一條
  - 一張卡片有三條以上額度時（例如 Claude 有每週 Opus／Sonnet）排成兩欄（左 5 小時、右每週），卡片不會變高
  - Codex：短窗與每週（依方案）
  - 還沒開始計時的額度一律顯示「還沒用，用了才開始計時」：已用 0% 而且服務沒給重置時間（例如 Claude 的 5 小時），或給的重置時間剛好是「現在＋整個週期」、每次更新都往後推（例如 Codex 免費版每月、Gemini 的 5 小時）
  - OpenRouter：跟其他卡片同一種排法：一行「餘額（USD）」與金額（負的是紅色）、「已用／總額」的進度條、已用金額
- **顏色**：90% 以上紅；知道週期長度的額度，用量超過時間線（見下一點）10 個百分點以上才變橘，代表用得比時間快（例如 75% 但這一輪快結束了，不變色）；不知道週期長度的照舊 70% 變橘。百分比數字跟著變色，簡約風格的卡片左邊也會多一條狀態色（冒險風格是「快用完了！」泡泡）。超過 3 個更新週期沒有新資料標「資料已過期」（被限流還在等退避的不算）
- **資料時間**：右上角的狀態寫「即時 · 3 分鐘前更新」（各家最新一筆資料的時間，滑鼠移上去看確切時間；手機連著時只寫「3 分鐘前更新」）。離線時上方橫幅寫「離線：顯示的是 12 分鐘前的數字，連上網路後會自動更新」。某一家超過 2 個更新週期沒新資料，那張卡片底下另外寫「資料時間 N 分鐘前」
- **時間進度**：知道週期長度的額度（5 小時、每週…），進度條上有一條細線標出這個週期已經過了多少時間；用量條沒超過這條線就是還寬裕（滑鼠移上去會寫「時間過了 45%，用了 11%」）
- **預估用完時間**：照目前速度會在重置前用完時，額度底下多一行橘色的「照目前速度約 2 小時 10 分後用完」（伺服器算的）。5 小時這種短週期看最近 90 分鐘的速度（跟推播的速度預警同一套算法）；每週、每月看這一輪的平均速度，而且至少過了 1 天才算（寫程式時一小時漲幾 % 很正常，拿來往後推好幾天會一直說快用完）
- 出錯時在錯誤後面寫下次重試的倒數，例如「503 服務暫時有問題（3 分鐘後重試）」
- **兩種風格**（右上角旗子按鈕切換，會記住）：
  - 簡約：深藍細線的資料儀表板風格
  - 冒險：原創的像素 RPG 風格，春夏秋冬四張地圖輪流（遠山、遠丘、遠方小鎮、帶樹冠的近丘多層遠景慢慢橫移，四季各一套配色；天上有柔和的雲、漂浮小島，春夏有彩虹；夜晚有月亮，小鎮的窗戶和招牌會亮燈）（小勇者走進右邊的傳送點就換下一季）、會動的原創怪物（點了會跳）、用量上升時卡片跳出「+N%」、額度用到 90% 以上冒「快用完了！」
- **亮色／暗色**（太陽／月亮按鈕）：沒選過就跟隨系統（系統切換時也跟著變）；冒險風格裡是白天／夜晚
- **只看風景**（冒險風格的山形按鈕或 B 鍵）：收起所有卡片只留場景，按「顯示用量」、Esc 或點兩下背景回來
- **快捷鍵**（冒險風格）：B 只看風景、M 換地圖、T 白天／夜晚、S 換風格
- **手機的頂列**維持一排（標題、連線狀態、通知、亮暗、⋯）：換風格、只看風景、安裝收在「⋯」選單裡；觸控裝置上頂列按鈕會放大，比較好點
- **易讀性**：小字對比至少 4.5:1、最小 12px（前端 smoke test 會檢查兩種風格、亮暗都過）；用鍵盤操作時有明顯的焦點框
- **OpenRouter 熱門模型**：免費／付費前 10 名（每天／每週／每月），付費附每百萬 token 價格
- **Claude 到期日**：設 `CLAUDE_PLAN_EXPIRES_AT=YYYY-MM-DD`，剩 30 天內變橘色

冒險風格的像素圖全部是原創點陣，放在 `public/pixel/`，由 `scripts/gen-pixel-art.mjs` 產生；角色在 `scripts/pixel-art/characters.mjs`、場景圖塊在 `scripts/pixel-art/scenery.mjs`，改完執行 `node scripts/gen-pixel-art.mjs`。

## 加到主畫面

- iPhone／iPad：瀏覽器的「分享」→「加入主畫面」（頁面頂端會提示，按「知道了」就不再出現）
- Android、電腦的 Chrome／Edge：點頁面右上的「安裝」（瀏覽器支援時才會出現；手機在「⋯」選單裡）。安裝畫面會帶截圖（`public/screenshots/`，畫面改了照 AGENTS.md 的說明重新截）

離線時會顯示上次的數字與熱門模型並標示「離線」。部署新版後頁面頂端會出現「有新版本，點此重新載入」（改前端檔案時記得把 `public/sw.js` 的 `CACHE` 版本號 +1）。

## 專案結構

```
server.js                 進入點：組裝各元件並啟動 HTTP 伺服器
src/poller.js             觀看者計數、每家排程、退避、共用 in-flight Promise
src/forecast.js           預估用完時間（短週期看最近的速度、長週期看這一輪的平均速度）
src/snapshot.js           記憶體快照、/data/snapshot.json 原子寫入
src/routes.js             路由：公開 API、SSE、管理 API、ACCESS_KEY
src/push-routes.js        推播 API：/api/push/tick 與裝置訂閱、設定、測試
src/static.js             靜態檔（擋路徑穿越、br／gzip 預先壓好放記憶體、ETag）
src/respond.js            回應與驗證的共用小工具（JSON、安全標頭、固定時間比較）
src/rankings.js           OpenRouter 模型排行（每小時最多抓一次）
src/alerts.js             推播規則（用量警告、快重置還有剩、額度重置了、勿擾時段；純函式）
src/time.js               時區換算與時間寫法（推播內容用）
src/push.js               推播服務：判斷、去重、每日上限、發送
src/push-store.js         推播存檔 /data/push.json：裝置訂閱、全站設定、樣本、已發紀錄與每日次數
src/webpush.js            Web Push：VAPID 簽名與 RFC 8291 加密（只用內建 crypto）
src/credentials.js        環境變數＋加密 volume、每家續期鎖
src/sse.js                SSE 連線、ping 事件、廣播、單一連線最長 30 分鐘、連線數上限
src/http.js               對外請求、錯誤分類、Cloudflare 偵測
src/oauth.js              refresh_token 續期、先存再用、401 續期重試（Claude／Codex 共用）
src/config.js             環境變數設定（含各家端點覆寫與手動設定值）
src/errors.js             ProviderError（錯誤種類）、Retry-After 解析
src/fsutil.js、log.js     原子寫檔、一行一筆 JSON log
src/providers/*.js        四家 adapter（統一輸出 { plan, planExpiresAt?, windows, balance, note }）；顯示順序在 index.js
public/                   PWA（index.html、style.css、sw.js、manifest、icons）
public/app.js             前端進入點：資料與連線（快照、SSE、SSE 被擋時改輪詢）
public/ui/                前端模組：cards（卡片）、windows（一條額度：進度條、時間進度、顏色、預估用完）、
                          rankings（排行）、effects（冒險效果）、theme-toggle（亮暗與風格）、menu（手機的「更多」選單）、
                          pwa（離線與安裝）、push（通知設定）、format、dom（共用狀態）
public/theme.js           畫面出現前套用亮暗與風格（CSP 不允許內嵌 script）
public/skin-adventure.css 冒險風格的卡片、按鈕與遊戲介面（只在 data-skin="adventure" 生效）
public/scene.css          冒險風格的場景（天空、地形、怪物、勇者、傳送點、夜晚）
public/scene.js           場景邏輯：建立地圖、勇者走到傳送點換季、怪物互動、只看風景、快捷鍵
public/scene-maps.js      四季地圖資料（加地圖改這裡）
public/pixel/             原創像素圖（由 scripts/gen-pixel-art.mjs 產生）
public/icons/             App 圖示；badge-96.png 是推播的小圖示（scripts/gen-badge.mjs 產生）
public/screenshots/       安裝畫面用的截圖
scripts/                  extract-credentials.js、setup-antigravity.ps1、gen-pixel-art.mjs、gen-badge.mjs、smoke-ui.mjs、gen-vapid.mjs
scripts/pixel-art/        像素圖產生器：lib（調色盤、點陣轉 SVG、畫布 DSL）、characters（勇者與怪物）、scenery（場景與四季換色）
docs/TECHNICAL.md         技術文件（設計細節）
docs/TODO.md              之後可以做的事
test/                     node:test＋假 fetch＋fixtures
google_apps_script/Code.gs  推播排程喚醒（Apps Script 觸發器的原始碼副本）
```
