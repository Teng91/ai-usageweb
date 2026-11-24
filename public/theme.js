// 在畫面出現前套用使用者選的亮色／暗色，避免先閃一下另一個主題（CSP 不允許內嵌 script，所以獨立一個檔案）
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    // 不能讀就跟隨系統
  }
})();
