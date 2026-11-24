// 冒險風格的小遊戲效果（簡約風格時 CSS 會把它們藏起來）

const lastPct = new Map(); // `${provider}:${window}` → 上次的已用 %

/** 用量上升時從卡片跳出「+3%」；額度用到 90% 以上時頭上冒「快用完了！」泡泡（餘額不提醒） */
export function gameEffects(el, p) {
  let rise = 0;
  let low = false;
  for (const w of p.windows || []) {
    const key = `${p.id}:${w.id}`;
    const prev = lastPct.get(key);
    if (prev !== undefined && w.usedPct > prev) rise = Math.max(rise, w.usedPct - prev);
    lastPct.set(key, w.usedPct);
    if (w.usedPct >= 90) low = true;
  }

  let bubble = el.querySelector('.alert-bubble');
  if (low && !bubble) {
    bubble = document.createElement('span');
    bubble.className = 'alert-bubble';
    bubble.textContent = '快用完了！';
    el.querySelector('.card-head').append(bubble);
  }
  if (bubble) bubble.hidden = !low;

  if (rise >= 0.5 && document.documentElement.dataset.skin === 'adventure') {
    const n = document.createElement('span');
    n.className = 'dmg';
    n.textContent = `+${Math.round(rise)}%`;
    el.append(n);
    n.addEventListener('animationend', () => n.remove());
  }
}
