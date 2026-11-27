// 亮色／暗色與簡約／冒險風格的切換鈕
// data-theme 一律由 /theme.js 在畫面出現前設好（選過的，或沒選就照系統）；沒選過時系統切換亮暗會跟著變
// 按一下切到另一個並記住（/theme.js 會在下次載入時、畫面出現前套用）
import { $, readStore, writeStore } from './dom.js';

const THEME_COLORS = {
  minimal: { light: '#f4f6fa', dark: '#070b16' },
  adventure: { light: '#7fd0ff', dark: '#0d1440' },
};
const root = document.documentElement;
const systemLight = window.matchMedia('(prefers-color-scheme: light)');

/** 使用者按按鈕選過的亮暗；沒選過回 null（跟隨系統） */
function chosenTheme() {
  const t = readStore('theme');
  return t === 'light' || t === 'dark' ? t : null;
}

const systemTheme = () => (systemLight.matches ? 'light' : 'dark');

function currentTheme() {
  return root.dataset.theme === 'light' ? 'light' : 'dark';
}

function currentSkin() {
  return root.dataset.skin === 'adventure' ? 'adventure' : 'minimal';
}

function renderButtons() {
  const theme = currentTheme();
  const skin = currentSkin();
  // 冒險風格裡亮色／暗色就是白天／夜晚
  const label = skin === 'adventure'
    ? (theme === 'dark' ? '切換成白天' : '切換成夜晚')
    : (theme === 'dark' ? '切換成亮色' : '切換成暗色');
  const btn = $('theme-btn');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  $('theme-color').setAttribute('content', THEME_COLORS[skin][theme]);
  const skinLabel = skin === 'adventure' ? '簡約風' : '冒險風';
  $('skin-label').textContent = skinLabel;
  $('skin-btn').title = `切換成${skinLabel}格`;
  $('skin-btn').setAttribute('aria-label', `切換成${skinLabel}格`);
}

export function initThemeToggle() {
  $('theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    writeStore('theme', next);
    renderButtons();
  });
  $('skin-btn').addEventListener('click', () => {
    const next = currentSkin() === 'adventure' ? 'minimal' : 'adventure';
    if (next === 'adventure') root.dataset.skin = 'adventure';
    else delete root.dataset.skin;
    writeStore('skin', next);
    renderButtons();
  });
  // 沒選過就跟著系統切換
  systemLight.addEventListener('change', () => {
    if (!chosenTheme()) root.dataset.theme = systemTheme();
    renderButtons();
  });
  // 保險：theme.js 沒跑到（不該發生）時也要有 data-theme，CSS 只看它
  if (root.dataset.theme !== 'light' && root.dataset.theme !== 'dark') root.dataset.theme = chosenTheme() || systemTheme();
  renderButtons();
}
