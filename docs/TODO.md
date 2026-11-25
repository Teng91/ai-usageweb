# 之後可以做的事

給之後接手的人（或 AI）看。做完就從這裡刪掉。

## 推播

- **OpenRouter 餘額提醒**：餘額低於門檻（例如 `PUSH_OPENROUTER_MIN=5`）時通知一次，儲值回到門檻以上才會再通知。目前沒在儲值所以先不做；規則加在 `src/alerts.js`，`kind` 可以用 `balance`，前端對話框多一個開關。
- **Antigravity 的窗口長度**：API 沒給 `periodSec`，所以不會發「快重置還有剩」。確認重置週期後在 `src/providers/antigravity.js` 補上（或從 `resetTime` 的變化推算）。
- **在網頁上調整勿擾時段與門檻**：目前勿擾時段用環境變數 `PUSH_QUIET`，門檻寫在 `RULES`。要的話存進每個訂閱的 `prefs`。
- **更準的喚醒**：GitHub Actions 的排程常晚 5–15 分鐘。若不夠用可以改用 fly 的排程機器或外部 cron 服務。
- **確認排程續命有效**：`push-tick.yml` 每天呼叫 enable API，用來避免「60 天沒 commit 自動停用」。GitHub 沒有文件保證這會重設計時；若哪天還是被停用（會收到 GitHub 的信），改用外部 cron 服務。
- **用量警告在勿擾時段結束後補發**：現在只是重新判斷（睡覺時沒在用，速度預警通常不會再成立，只剩 95% 保底）。
