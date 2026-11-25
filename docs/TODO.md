# 之後可以做的事

給之後接手的人（或 AI）看。做完就從這裡刪掉。

## 推播

- **OpenRouter 餘額提醒**：餘額低於門檻（例如 `PUSH_OPENROUTER_MIN=5`）時通知一次，儲值回到門檻以上才會再通知。目前沒在儲值所以先不做；規則加在 `src/alerts.js`，`kind` 可以用 `balance`，前端對話框多一個開關。
- **Antigravity（卡片名 Gemini）免費方案的窗口長度**：付費方案從 `retrieveUserQuotaSummary` 拿到 Gemini、Claude/GPT 兩組的 5 小時／每週並填了 `periodSec`（要用 agy CLI 格式的 User-Agent 才會給 Gemini 組）；免費方案只有 `fetchAvailableModels`，沒給長度，所以不會發「快重置還有剩」。確認免費方案的重置週期後在 `mergeWindows` 補上。
- **在網頁上調整勿擾時段與門檻**：目前勿擾時段用環境變數 `PUSH_QUIET`，門檻寫在 `RULES`。要的話存進每個訂閱的 `prefs`。
- **確認排程續命有效**：備援的 `push-tick.yml` 每天呼叫 enable API，用來避免「60 天沒 commit 自動停用」。GitHub 沒有文件保證這會重設計時；主要的喚醒已改由 Google Apps Script 負責，備援被停用也不影響推播。
- **用量警告在勿擾時段結束後補發**：現在只是重新判斷（睡覺時沒在用，速度預警通常不會再成立，只剩 95% 保底）。
