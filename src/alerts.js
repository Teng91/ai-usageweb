// 推播的判斷規則（純函式，不碰網路與檔案，方便測試）
//  A. 用量警告：依最近的消耗速度，預估重置前會用完才通知；週／月額度另外在 80%、90% 各通知一次；95% 一定通知
//  B. 快重置還有剩：只看週／月這種長週期，24h 剩 ≥40%、12h 剩 ≥20%、6h 剩 ≥10% 各提醒一次

const MIN = 60_000;
const HOUR = 60 * MIN;

export const RULES = {
  warnFloorPct: 50, // 低於這個不做速度預警，避免一開工就被叫
  hardPct: 95, // 到這裡一定通知
  longThresholds: [90, 80], // 週／月額度的固定門檻預設值（由高到低），同一週期各一次；可在網頁上改
  rateLookbackMs: 90 * MIN, // 用這段時間內的樣本估速度
  rateMinSpanMs: 10 * MIN, // 樣本至少跨這麼久才估
  rateMinDelta: 2, // 這段時間至少漲幾個百分點才算「在用」
  inUseLookbackMs: 60 * MIN, // 這段時間內用量有漲就當作正在用，不發「快重置」
  keepSamplesMs: 3 * HOUR,
  longPeriodSec: 3 * 86400, // 週期至少這麼長才發「快重置」
  stages: [ // 由緊到鬆
    { id: '6h', hours: 6, minRemaining: 10 },
    { id: '12h', hours: 12, minRemaining: 20 },
    { id: '24h', hours: 24, minRemaining: 40 },
  ],
};

// ---------- 樣本 ----------

/** 記一筆樣本；換了重置週期（或用量突然下降＝提早重置）就清掉舊樣本 */
export function recordSample(history, key, win, now) {
  const r = win.resetsAt ? Date.parse(win.resetsAt) : null;
  const pct = Number(win.usedPct);
  if (!Number.isFinite(pct)) return history[key];
  let h = history[key];
  const last = h?.samples[h.samples.length - 1];
  const newCycle = !h
    || (r && h.resetsAt && Math.abs(r - h.resetsAt) > 30 * MIN) // 重置時間每次可能差幾秒，差很多才算新週期
    || (h.resetsAt && now > h.resetsAt + MIN)
    || (last && last[1] - pct > 5);
  if (newCycle) h = history[key] = { cycle: String(r ?? `t${now}`), resetsAt: r, samples: [] };
  else if (r) h.resetsAt = r;
  const tail = h.samples[h.samples.length - 1];
  if (tail && now - tail[0] < 30_000) tail[1] = pct;
  else h.samples.push([now, pct]);
  h.samples = h.samples.filter(([t]) => now - t <= RULES.keepSamplesMs);
  return h;
}

/** 最近的消耗速度（百分點／毫秒）；資料不夠回 null */
export function burnRate(h, now) {
  const recent = h.samples.filter(([t]) => now - t <= RULES.rateLookbackMs);
  if (recent.length < 2) return null;
  const [t0, p0] = recent[0];
  const [t1, p1] = recent[recent.length - 1];
  if (t1 - t0 < RULES.rateMinSpanMs) return null;
  const delta = p1 - p0;
  if (delta < RULES.rateMinDelta) return 0;
  return delta / (t1 - t0);
}

export function inUse(h, now) {
  const recent = h.samples.filter(([t]) => now - t <= RULES.inUseLookbackMs);
  if (recent.length < 2) return false;
  const cur = recent[recent.length - 1][1];
  return cur - Math.min(...recent.map(([, p]) => p)) >= 1;
}

// ---------- 時間（依設定的時區） ----------

/** 當地時間的各欄位；offsetMs = 當地時間 − UTC */
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
  });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const y = Number(o.year), mo = Number(o.month), d = Number(o.day), hh = Number(o.hour), mm = Number(o.minute);
  const offsetMs = Date.UTC(y, mo - 1, d, hh, mm) - Math.floor(ms / MIN) * MIN;
  return { y, mo, d, hh, mm, weekday: o.weekday, offsetMs, dateKey: `${y}-${mo}-${d}` };
}

/** "00-08" → { start: 0, end: 8 }；格式不對就回 null（不設勿擾） */
export function parseQuiet(raw) {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const start = Number(m[1]), end = Number(m[2]);
  if (start > 23 || end > 24 || start === end) return null;
  return { start, end: end % 24 };
}

const inRange = (h, a, b) => (a < b ? h >= a && h < b : h >= a || h < b);

export function quietState(now, tz, quiet) {
  if (!quiet) return { quiet: false, preQuiet: false, quietEndsAt: null };
  const p = localParts(now, tz);
  const isQuiet = inRange(p.hh, quiet.start, quiet.end);
  const preQuiet = !isQuiet && inRange(p.hh, (quiet.start + 22) % 24, quiet.start);
  // 下一次勿擾結束的時間
  const midnight = Date.UTC(p.y, p.mo - 1, p.d) - p.offsetMs;
  let end = midnight + quiet.end * HOUR;
  while (end <= now) end += 24 * HOUR;
  return { quiet: isQuiet, preQuiet, quietEndsAt: end };
}

const WEEK = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

/** 重置時間的寫法：今天 16:00／明天 10:00／11/27（四）10:00 */
export function formatWhen(ms, now, tz) {
  const t = localParts(ms, tz);
  const n = localParts(now, tz);
  const hm = `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}`;
  const dayDiff = Math.round((Date.UTC(t.y, t.mo - 1, t.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000);
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return `明天 ${hm}`;
  return `${t.mo}/${t.d}（${WEEK[t.weekday] || ''}）${hm}`;
}

export function formatDuration(ms) {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  if (h < 10) return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
  if (h < 48) return `${Math.round(m / 60)} 小時`;
  return `${Math.round(m / 1440)} 天`;
}

const pctText = (v) => `${Math.round(v)}%`;

// ---------- 判斷 ----------

/**
 * 依目前資料算出要發的通知（不改 sent，由呼叫端決定要不要記下）。
 * providers：快照的 provider view；history：recordSample 累積的樣本；sent：已發過的 key。
 * quiet：勿擾時段 { start, end } 或 null；thresholds：週／月額度的固定門檻（由高到低）。
 * 回傳 [{ kind: 'usage'|'reset', provider, keys: [...], title, body }]
 */
export function evaluateAlerts({ providers, history, sent, now, tz, quiet, thresholds = RULES.longThresholds }) {
  const tList = [...thresholds].sort((a, b) => b - a);
  const q = quietState(now, tz, quiet);
  const out = [];
  for (const p of providers) {
    if (p.status !== 'ok' && p.status !== 'stale') continue;
    for (const w of p.windows || []) {
      const h = history[`${p.id}:${w.id}`];
      if (!h) continue;
      const pct = Number(w.usedPct);
      const r = w.resetsAt ? Date.parse(w.resetsAt) : null;
      if (r && r <= now) continue;
      const name = `${p.name} ${w.label}`;
      const base = `${p.id}:${w.id}:${h.cycle}`;
      const resetText = r ? formatWhen(r, now, tz) : null;

      // ---- A. 用量警告（勿擾時段不發，之後再重新判斷） ----
      if (!q.quiet) {
        const kHard = `usage:${base}:hard`;
        const kWarn = `usage:${base}:warn`;
        if (pct >= RULES.hardPct && !sent[kHard]) {
          out.push({
            // 低的門檻一起記下，到 95% 之後不會再補發 90%／80%
            kind: 'usage', provider: p.id, keys: [kHard, kWarn, ...tList.map((t) => `usage:${base}:t${t}`)],
            title: `⚠️ ${name} 已用 ${pctText(pct)}`,
            body: r ? `${resetText} 才重置（還要 ${formatDuration(r - now)}）` : '快用完了',
          });
          continue;
        }
        // 週／月這種長週期漲得慢，速度預警很難成立：另外在固定門檻（預設 90%、80%）各提醒一次
        if (Number(w.periodSec) >= RULES.longPeriodSec) {
          const idx = tList.findIndex((t) => pct >= t && !sent[`usage:${base}:t${t}`]);
          if (idx >= 0 && !tList.slice(0, idx).some((t) => pct >= t)) {
            out.push({
              kind: 'usage', provider: p.id,
              keys: tList.slice(idx).map((t) => `usage:${base}:t${t}`), // 低的門檻一起記下
              title: `⚠️ ${name} 已用 ${pctText(pct)}`,
              body: r ? `${resetText} 重置（還有 ${formatDuration(r - now)}）` : '快用完了',
            });
            continue;
          }
        }
        const rate = burnRate(h, now);
        if (pct >= RULES.warnFloorPct && rate > 0 && r && !sent[kWarn]) {
          const eta = (100 - pct) / rate;
          if (now + eta < r - 5 * MIN) {
            out.push({
              kind: 'usage', provider: p.id, keys: [kWarn],
              title: `⚠️ ${name} 已用 ${pctText(pct)}`,
              body: `照目前速度約 ${formatDuration(eta)} 用完，${resetText} 才重置`,
            });
            continue;
          }
        }
      }

      // ---- B. 快重置還有剩 ----
      if (q.quiet || !r || !(Number(w.periodSec) >= RULES.longPeriodSec)) continue;
      if (inUse(h, now)) continue;
      // 勿擾前 2 小時：把勿擾期間會遇到的提醒提前發
      const evalAt = q.preQuiet ? Math.min(q.quietEndsAt, r) : now;
      const left = r - evalAt;
      const stageIdx = RULES.stages.findIndex((s) => left <= s.hours * HOUR);
      if (stageIdx < 0) continue;
      const stage = RULES.stages[stageIdx];
      const kStage = `reset:${base}:${stage.id}`;
      const remaining = 100 - pct;
      if (sent[kStage] || remaining < stage.minRemaining) continue;
      out.push({
        kind: 'reset', provider: p.id,
        keys: RULES.stages.slice(stageIdx).map((s) => `reset:${base}:${s.id}`), // 鬆的階段一起記下，不會倒過來再發
        title: `💡 ${name} 還剩 ${pctText(remaining)}`,
        body: `${resetText} 重置（還有 ${formatDuration(r - now)}），有想跑的任務可以趁現在`,
      });
    }
  }
  return out;
}

/** 同一類合成一則 */
export function mergeAlerts(alerts) {
  const byKind = new Map();
  for (const a of alerts) {
    if (!byKind.has(a.kind)) byKind.set(a.kind, []);
    byKind.get(a.kind).push(a);
  }
  return [...byKind].map(([kind, list]) => {
    if (list.length === 1) return { kind, title: list[0].title, body: list[0].body };
    const head = kind === 'usage' ? `⚠️ 額度警告（${list.length} 項）` : `💡 快重置還有剩（${list.length} 項）`;
    return { kind, title: head, body: list.map((a) => `${a.title.replace(/^\S+\s/, '')}：${a.body}`).join('\n') };
  });
}
