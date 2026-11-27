// 手機的「更多」選單：比較少用的按鈕（只看風景、換風格、安裝）收在這裡，頂列維持一排。
// 寬螢幕時選單是攤開的（CSS 讓它 display: contents），按鈕照常排在頂列，「更多」按鈕不顯示。
import { $ } from './dom.js';

export function initMenu() {
  const btn = $('more-btn');
  const menu = $('more-menu');
  const isOpen = () => menu.hasAttribute('data-open');
  const setOpen = (open) => {
    menu.toggleAttribute('data-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => setOpen(!isOpen()));
  // 點了裡面的按鈕（換風格、只看風景、安裝）就收起來
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) setOpen(false); });
  // 點外面、按 Esc 也收起來
  document.addEventListener('click', (e) => {
    if (isOpen() && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      btn.focus();
    }
  });
}
