// PWA：service worker（新版本提示）、安裝按鈕、iPhone 的「加入主畫面」提示
import { $, readStore, writeStore } from './dom.js';

export function initPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const showUpdate = (worker) => {
        $('update-banner').hidden = false;
        $('update-btn').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
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
      if (reloading) return;
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
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 會偽裝成 Mac
  const isStandalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIos && !isStandalone && readStore('iosHintDismissed') !== '1') $('ios-banner').hidden = false;
  $('ios-banner-close').addEventListener('click', () => {
    $('ios-banner').hidden = true;
    writeStore('iosHintDismissed', '1');
  });
}
