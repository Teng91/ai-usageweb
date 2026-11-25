// ai-usageweb 推播排程：Google Apps Script 的時間觸發器每 15 分鐘叫醒 fly.io 上的伺服器，
// 抓一輪各家用量並判斷要不要推播（POST /api/push/tick）。
//
// 為什麼不用 GitHub Actions 的 schedule：它常常延遲好幾個小時、尖峰時段甚至整次跳過；
// Apps Script 的觸發器準時得多。這裡直接打伺服器，不經過 GitHub。
//
// 設定方式見 README「手機通知（Web Push）」：
//   1. 貼到 script.google.com 的新專案，改 APP_URL
//   2. 專案設定 → 指令碼屬性，新增 PUSH_TICK_TOKEN（跟 fly secrets 的同一個值）
//   3. 手動執行一次 tick（第一次會要求授權），看「執行項目」的紀錄是 {"ok":true,...}
//   4. 執行 installTrigger 建立觸發器（可以重複執行，會先清掉舊的）
//
// 這個檔案只是副本，真正在跑的是 Apps Script 專案裡那份：改了要兩邊一起改。

const APP_URL = 'https://ai-usageweb.fly.dev';
// Apps Script 的分鐘觸發器只接受 1、5、10、15、30
const INTERVAL_MINUTES = 15;

function tick() {
  const token = PropertiesService.getScriptProperties().getProperty('PUSH_TICK_TOKEN');
  if (!token) throw new Error('指令碼屬性缺少 PUSH_TICK_TOKEN');
  const options = {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  // 機器剛被喚醒或暫時連不上時再試一次
  let code = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(APP_URL + '/api/push/tick', options);
      code = res.getResponseCode();
      if (code === 200) {
        console.log(res.getContentText()); // 只有 {"ok":true,"sent":N}，不含 token
        return;
      }
      if (code === 401) throw new Error('PUSH_TICK_TOKEN 不對（伺服器回 401）');
    } catch (err) {
      if (String(err.message).indexOf('401') >= 0 || attempt === 2) throw err;
    }
    Utilities.sleep(10000);
  }
  throw new Error('叫醒失敗：HTTP ' + code);
}

function installTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(INTERVAL_MINUTES).create();
  console.log('已建立觸發器：每 ' + INTERVAL_MINUTES + ' 分鐘執行 tick');
}
