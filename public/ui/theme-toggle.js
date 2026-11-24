// 亮色／暗色與簡約／冒險風格的切換鈕
// 沒選過就跟隨系統；按一下切到另一個並記住（/theme.js 會在下次載入時、畫面出現前套用）
import { $, writeStore } from './dom.js';

const THEME_COLORS = {
  minimal: { light: '#f4f6fa', dark: '#070b16' },
  adventure: { light: '#7fd0ff', dark: '#0d1440' },
};
const root = document.documentElement;
const systemLight = window.matchMedia('(prefers-color-scheme: light)');

function currentTheme() {
  const t = root.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return systemLight.matches ? 'light' : 'dark';
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
  systemLight.addEventListener('change', renderButtons);
  renderButtons();
}
