// 在畫面出現前套用使用者選的風格（簡約／冒險）與亮色／暗色，避免先閃一下另一個主題
// data-theme 一律設好（選過的，或沒選就照系統），CSS 只看 data-theme，色票只寫一份；系統切換時由 ui/theme-toggle.js 跟著改
// （CSP 不允許內嵌 script，所以獨立一個檔案）
(function () {
  var root = document.documentElement;
  var t = null;
  try {
    t = localStorage.getItem('theme');
    if (localStorage.getItem('skin') === 'adventure') root.setAttribute('data-skin', 'adventure');
  } catch (e) {
    // 不能讀就用預設：簡約、跟隨系統
  }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.setAttribute('data-theme', t);
})();
