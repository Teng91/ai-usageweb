import path from 'node:path';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';

// 每日用量歷史：每個服務、每個額度窗口記當天的「最高已用 %」；OpenRouter 記當天最後的餘額。
// 只在有人看、有抓到資料時記錄，所以沒人看的日子會是空的。只存百分比與餘額，不存任何帳號資訊。
const KEEP_DAYS = 45;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const FORMAT_VERSION = 1;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/** 指定時區的日期字串 YYYY-MM-DD */
export function dayKey(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

export class HistoryStore {
  constructor({ dataDir, tz = 'Asia/Taipei', now = Date.now }) {
    this.file = path.join(dataDir, 'history.json');
    this.tz = tz;
    this.now = now;
    this.days = {}; // { 'YYYY-MM-DD': { providerId: { windowId: peakPct, $balance?: number } } }
    this.dirty = false;
    this.lastSave = 0;
    this.writeChain = Promise.resolve();
  }

  async load() {
    const raw = await readFileOrNull(this.file);
    if (!raw) return this;
    try {
      const d = JSON.parse(raw.toString('utf8'));
      if (d?.version === FORMAT_VERSION && d.days && typeof d.days === 'object') this.days = d.days;
    } catch {
      logWarn('history.json 壞了，從空白開始');
    }
    return this;
  }

  /** 一次成功抓取的結果（adapter 的統一格式） */
  record(id, result) {
    const day = dayKey(this.now(), this.tz);
    const entry = ((this.days[day] ||= {})[id] ||= {});
    for (const w of result?.windows || []) {
      const v = Number(w?.usedPct);
      if (!w?.id || !Number.isFinite(v)) continue;
      entry[w.id] = round1(Math.max(entry[w.id] ?? 0, v));
    }
    const bal = Number(result?.balance?.remaining);
    if (result?.balance && Number.isFinite(bal)) entry.$balance = round2(bal);
    this.prune();
    this.dirty = true;
    if (this.now() - this.lastSave >= SAVE_EVERY_MS) this.save().catch(() => {});
  }

  prune() {
    const keys = Object.keys(this.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete this.days[k];
  }

  /** 對外：最近 n 天（有資料的日子），由舊到新 */
  view(n = 30) {
    const keys = Object.keys(this.days).sort().slice(-n);
    return { tz: this.tz, today: dayKey(this.now(), this.tz), days: keys.map((date) => ({ date, providers: this.days[date] })) };
  }

  async save() {
    // 沒有新資料也要等前一次寫檔完成（關機時才不會漏）
    if (!this.dirty) return this.writeChain;
    this.dirty = false;
    this.lastSave = this.now();
    const text = JSON.stringify({ version: FORMAT_VERSION, days: this.days });
    const job = this.writeChain.then(() => writeFileAtomic(this.file, text));
    this.writeChain = job.catch(() => {});
    await job;
  }
}
