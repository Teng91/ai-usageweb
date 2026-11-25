// PWA：service worker（新版本提示）、安裝按鈕、iPhone 的「加入主畫面」提示
import { $, readStore, writeStore, isIos, isStandalone } from './dom.js';

export function initPwa() {
  if ('serviceWorker' in navigator) {
    // 只有按了「重新載入」換成新版本才重整；第一次造訪時 service worker 接手（clients.claim）也會觸發 controllerchange，那時不必重整
    let updateRequested = false;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const showUpdate = (worker) => {
        $('update-banner').hidden = false;
        $('update-btn').onclick = () => {
          updateRequested = true;
          // 別的分頁已經先換好新版本了：這裡直接重整
          if (worker.state === 'activated') location.reload();
          else worker.postMessage({ type: 'SKIP_WAITING' });
        };
      };
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      // 每次回到前景檢查一次新版本
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !updateRequested) return;
      reloading = true;
      location.reload();
    });
  }

  // 瀏覽器支援安裝時才顯示「安裝」
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('install-btn').hidden = false;
  });
  $('install-btn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    $('install-btn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('install-btn').hidden = true; });

  // iPhone／iPad 不支援「安裝」按鈕，改提示用「分享 → 加入主畫面」；已經從主畫面打開或按過「知道了」就不再出現
  if (isIos() && !isStandalone() && readStore('iosHintDismissed') !== '1') $('ios-banner').hidden = false;
  $('ios-banner-close').addEventListener('click', () => {
    $('ios-banner').hidden = true;
    writeStore('iosHintDismissed', '1');
  });
}
