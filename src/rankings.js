import path from 'node:path';
import { requestJson } from './http.js';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';

// OpenRouter 排行榜頁面用的端點（非官方 API，可用環境變數覆寫）；模型名稱來自公開的模型列表
const RANKINGS_URL = process.env.OPENROUTER_RANKINGS_URL || 'https://openrouter.ai/api/frontend/v1/rankings/models';
const MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';

export const VIEWS = ['day', 'week', 'month'];
const TOP_N = 10;
// 排行榜變化很慢：最多每小時抓一次；失敗後 10 分鐘內不再試
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const MODELS_REFRESH_MS = 6 * 60 * 60 * 1000;

/** 「openai/gpt-6-luna-20260922」→ 找不到名稱時的備用顯示「gpt-6-luna」 */
function fallbackName(slug) {
  const last = String(slug).split('/').pop() || String(slug);
  return last.replace(/-\d{8}$/, '');
}

/** 每 token 的美元字串 → 每百萬 token 美元；負數（動態計價）或不是數字就當沒有 */
function perMillion(v) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 10000) / 10000;
}

/**
 * 模型列表 → { canonical_slug 或 id: { name, input, output } }。
 * 名稱去掉「OpenAI: 」這類廠商前綴；同一個模型的一般、免費、batch 變體共用 canonical_slug，
 * 名稱去掉變體標記後取第一個；價格（每百萬 token 的輸入／輸出美元）取一般版（id 不帶 :free、:batch）。
 */
export function parseModelCatalog(data) {
  const out = {};
  for (const m of Array.isArray(data?.data) ? data.data : []) {
    const name = typeof m?.name === 'string'
      ? m.name.replace(/^[^:]{1,40}:\s*/, '').replace(/\s*\((free|batch)\)$/i, '')
      : null;
    if (!name) continue;
    const base = typeof m.id === 'string' && !m.id.includes(':');
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    for (const key of [m.canonical_slug, m.id]) {
      if (!key) continue;
      if (!out[key]) out[key] = { name, input: null, output: null };
      if (base && input !== null && output !== null) Object.assign(out[key], { input, output });
    }
  }
  return out;
}

/**
 * 排行榜原始資料（每列是某個時間桶裡某模型某變體的用量）→ 免費／付費各前 10 名。
 * 依 prompt＋completion token 總量排名；variant 為 free 的算免費，其餘（standard、batch…）算付費。
 */
export function parseRankings(data, catalog = {}) {
  const rows = Array.isArray(data?.data) ? data.data : null;
  if (!rows) throw new Error('排行榜回傳缺少 data');
  const totals = { free: new Map(), paid: new Map() };
  for (const r of rows) {
    const slug = r?.model_permaslug;
    if (typeof slug !== 'string' || !slug) continue;
    const tokens = Number(r.total_prompt_tokens || 0) + Number(r.total_completion_tokens || 0);
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    const bucket = r.variant === 'free' ? totals.free : totals.paid;
    bucket.set(slug, (bucket.get(slug) || 0) + tokens);
  }
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([slug, tokens], i) => ({ rank: i + 1, slug, name: catalog[slug]?.name || fallbackName(slug), tokens }));
  // 付費模型附上一般版的價格（每百萬 token 的輸入／輸出美元），查不到就是 null
  const paid = top(totals.paid).map((m) => {
    const c = catalog[m.slug];
    return { ...m, price: c && c.input !== null ? { input: c.input, output: c.output } : null };
  });
  return { free: top(totals.free), paid };
}

/** 有人看時才抓（由 /api/rankings 觸發），每小時最多一次，結果存檔讓冷啟動也有資料 */
export class RankingsService {
  constructor({ dataDir, now = Date.now }) {
    this.file = path.join(dataDir, 'rankings.json');
    this.now = now;
    this.data = null; // { updatedAt, views: { day: {free, paid}, ... } }
    this.catalog = {};
    this.catalogAt = 0;
    this.lastAttemptAt = 0;
    this.inflight = null;
  }

  async load() {
    const raw = await readFileOrNull(this.file);
    if (!raw) return this;
    try {
      const d = JSON.parse(raw.toString('utf8'));
      if (d?.views) this.data = d;
    } catch {
      logWarn('rankings.json 壞了，重新抓');
    }
    return this;
  }

  isFresh() {
    return this.data && this.now() - Date.parse(this.data.updatedAt) < REFRESH_MS;
  }

  /** 回傳目前的資料；過期就在背景更新（沒有任何資料時才等它抓完） */
  async get() {
    if (!this.isFresh() && !this.inflight && this.now() - this.lastAttemptAt >= RETRY_MS) {
      this.inflight = this.refresh().finally(() => { this.inflight = null; });
    }
    if (!this.data && this.inflight) await this.inflight.catch(() => {});
    return this.data;
  }

  async refresh() {
    this.lastAttemptAt = this.now();
    try {
      if (this.now() - this.catalogAt > MODELS_REFRESH_MS) {
        try {
          const { data } = await requestJson(MODELS_URL, { label: 'OpenRouter 模型列表' });
          this.catalog = parseModelCatalog(data);
          this.catalogAt = this.now();
        } catch {
          // 模型列表拿不到就用 slug 顯示、不附價格，排行照樣更新
        }
      }
      const views = {};
      for (const view of VIEWS) {
        const { data } = await requestJson(`${RANKINGS_URL}?view=${view}`, { label: 'OpenRouter 排行榜' });
        views[view] = parseRankings(data, this.catalog);
      }
      this.data = { updatedAt: new Date(this.now()).toISOString(), views };
      await writeFileAtomic(this.file, JSON.stringify(this.data)).catch(() => {});
    } catch (err) {
      logWarn('排行榜更新失敗', { err: err?.message || 'error' });
    }
  }
}
