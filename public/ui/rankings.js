// OpenRouter 模型排行：免費／付費前 10 名，每天／每週／每月
import { withKey, readStore, writeStore } from './dom.js';
import { usd, tokens } from './format.js';

// 伺服器每小時才更新，前端 10 分鐘問一次就夠
const RANKINGS_POLL_MS = 10 * 60_000;
const RANK_VIEWS = [['day', '每天'], ['week', '每週'], ['month', '每月']];

let rankings = null;
let loadedAt = 0;
let failed = false;
let view = RANK_VIEWS.some(([id]) => id === readStore('rankView')) ? readStore('rankView') : 'week';
let root = null;

export function initRankings() {
  setInterval(() => {
    if (document.visibilityState === 'visible') loadRankings();
  }, RANKINGS_POLL_MS);
}

/** 太久沒更新才重抓（回到前景時呼叫） */
export function refreshRankingsIfStale() {
  if (Date.now() - loadedAt > RANKINGS_POLL_MS) loadRankings();
}

async function loadRankings() {
  loadedAt = Date.now();
  try {
    const res = await fetch(withKey('/api/rankings'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (data?.views) rankings = data;
    failed = !data?.views;
  } catch {
    failed = !rankings;
  }
  renderRankings();
}

/** 排行區塊只建一次，卡片重畫時搬回去，切換的分頁不會被重設 */
export function rankingsEl() {
  if (!root) {
    root = document.createElement('section');
    root.className = 'rank';
    root.setAttribute('aria-label', 'OpenRouter 熱門模型');
    const head = document.createElement('div');
    head.className = 'rank-head';
    const title = document.createElement('h3');
    title.className = 'rank-title';
    title.textContent = '熱門模型';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '時間範圍');
    for (const [id, label] of RANK_VIEWS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.view = id;
      b.textContent = label;
      b.addEventListener('click', () => {
        view = id;
        writeStore('rankView', id);
        renderRankings();
      });
      seg.append(b);
    }
    head.append(title, seg);
    const cols = document.createElement('div');
    cols.className = 'rank-cols';
    const foot = document.createElement('p');
    foot.className = 'rank-foot';
    root.append(head, cols, foot);
    renderRankings();
  }
  return root;
}

const span = (cls, text) => {
  const el = document.createElement('span');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

function renderRankings() {
  if (!root) return;
  for (const b of root.querySelectorAll('.seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
  const cols = root.querySelector('.rank-cols');
  const foot = root.querySelector('.rank-foot');
  cols.replaceChildren();
  const data = rankings?.views?.[view];
  if (!data) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = failed ? '暫時拿不到排行榜' : '排行榜載入中…';
    cols.append(n);
    foot.textContent = '';
    return;
  }
  for (const [key, label] of [['free', '免費模型'], ['paid', '付費模型']]) {
    const paid = key === 'paid';
    const col = document.createElement('div');
    col.className = paid ? 'rank-col paid' : 'rank-col';
    // 表頭：欄位名稱對齊下面每一列
    const h = document.createElement('div');
    h.className = 'rt-row rt-head';
    h.append(span('rk', '#'), span('nm', label), span('viz'), span('tk', 'Tokens'));
    if (paid) h.append(span('pr', '輸入 / 輸出 每 1M'));
    const ol = document.createElement('ol');
    ol.className = 'rank-list';
    const list = data[key] || [];
    const max = list[0]?.tokens || 1;
    for (const m of list) {
      const li = document.createElement('li');
      li.className = 'rt-row';
      const price = m.price ? `${usd(m.price.input)} / ${usd(m.price.output)}` : '—';
      li.title = `${m.name}（${m.slug}）\n${tokens(m.tokens)} tokens${paid ? `\n每百萬 token：輸入 ${m.price ? usd(m.price.input) : '—'}、輸出 ${m.price ? usd(m.price.output) : '—'}` : ''}`;
      // 單一系列的長條：長度＝跟第一名比的相對用量
      const viz = span('viz');
      const fill = span('viz-fill');
      fill.style.width = `${Math.max(2, (m.tokens / max) * 100)}%`;
      viz.append(fill);
      const nm = span('nm');
      nm.append(span('nm-text', m.name));
      if (paid) nm.append(span('pr-inline', price));
      li.append(span('rk', String(m.rank).padStart(2, '0')), nm, viz, span('tk', tokens(m.tokens)));
      if (paid) li.append(span('pr', price));
      ol.append(li);
    }
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'note';
      li.textContent = '沒有資料';
      ol.append(li);
    }
    col.append(h, ol);
    cols.append(col);
  }
  foot.textContent = '依 OpenRouter 全站 token 用量（輸入＋輸出）排名';
}
