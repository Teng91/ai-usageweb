# 之後可以做的事

給之後接手的人（或 AI）看。做完就從這裡刪掉。

## 推播

- **OpenRouter 餘額提醒**：餘額低於門檻（例如 `PUSH_OPENROUTER_MIN=5`）時通知一次，儲值回到門檻以上才會再通知。目前沒在儲值所以先不做；規則加在 `src/alerts.js`，`kind` 可以用 `balance`，前端對話框多一個開關。
- **Antigravity（卡片名 Gemini）免費方案的窗口長度**：付費方案從 `retrieveUserQuotaSummary` 拿到 Gemini 組的 5 小時／每週並填了 `periodSec`（Claude/GPT 組也有，但目前不顯示）（要用 agy CLI 格式的 User-Agent 才會給 Gemini 組）；免費方案只有 `fetchAvailableModels`，沒給長度，所以不會發「快重置還有剩」。確認免費方案的重置週期後在 `mergeWindows` 補上。
