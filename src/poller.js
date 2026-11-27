import { ProviderError } from './errors.js';
import { logJson, logInfo, logWarn } from './log.js';

const MAX_RATE_LIMIT_BACKOFF = 900;
const MAX_ERROR_BACKOFF = 300;
const PARSE_RETRY = 300;
const TICK_MS = 1000;

/**
 * 只在有人看時輪詢：
 *  - 觀看者 = SSE 連線數；GET /api/usage 也算「最近有人看」（給輪詢備援用）
 *  - 觀看者歸 0 後再等 idleGraceSec 才停
 *  - 每家各自的排程、退避、共用 in-flight Promise；兩次請求至少隔 minIntervalSec
 */
export class Poller {
  constructor({ providers, creds, snapshot, broadcast, pollIntervalSec, idleGraceSec, forecaster = null, now = Date.now, random = Math.random }) {
    this.providers = providers;
    this.forecaster = forecaster; // 選填：幫額度加上預估用完時間（src/forecast.js）
    this.creds = creds;
    this.snapshot = snapshot;
    this.broadcast = broadcast;
    this.pollIntervalSec = pollIntervalSec;
    this.idleGraceSec = idleGraceSec;
    this.now = now;
    this.random = random;
    this.viewers = 0;
    this.lastActivity = 0;
    this.timer = null;
    this.state = {};
    for (const p of providers) {
      const fetchedAt = snapshot.entry(p.id)?.fetchedAt;
      this.state[p.id] = {
        nextAt: 0,
        failures: 0,
        inflight: null,
        lastAttemptAt: fetchedAt ? Date.parse(fetchedAt) : 0,
        authBlockedVersion: null, // 續期失敗時記下當時的憑證版本，換新憑證才再試
        forbidden: false, // 403：這次觀看期間不再試
      };
    }
  }

  get running() {
    return this.timer !== null;
  }

  // ---- 觀看者 ----
  viewerJoined(count) {
    this.viewers = count;
    this.touch();
  }

  viewerLeft(count) {
    this.viewers = count;
    this.lastActivity = this.now();
  }

  /** 有人看了（SSE 連上或 GET /api/usage） */
  touch() {
    this.lastActivity = this.now();
    if (!this.running) this.start();
  }

  isActive() {
    if (this.viewers > 0) return true;
    return this.now() - this.lastActivity < this.idleGraceSec * 1000;
  }

  // ---- 迴圈 ----
  start() {
    if (this.running) return;
    const now = this.now();
    for (const p of this.providers) {
      const s = this.state[p.id];
      s.forbidden = false; // 新的觀看期間，403 再給一次機會
      const minGap = this.minInterval(p) * 1000;
      const jitter = Math.floor(this.random() * 2000);
      // 冷啟動不暴衝：上次抓取不到 minInterval 就不重抓
      s.nextAt = Math.max(s.nextAt, s.lastAttemptAt + minGap, now + jitter);
    }
    logInfo('poller start', { viewers: this.viewers });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    this.tick();
  }

  /** 等正在跑的抓取結束（關機用：續期拿到的新 token 要寫進 volume 才能結束，不然會遺失） */
  async drain() {
    await Promise.allSettled(Object.values(this.state).map((s) => s.inflight).filter(Boolean));
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.timer);
    this.timer = null;
    logInfo('poller stop');
  }

  tick() {
    if (!this.isActive()) {
      this.stop();
      return;
    }
    const now = this.now();
    for (const p of this.providers) {
      const s = this.state[p.id];
      if (s.inflight || s.forbidden) continue;
      if (now >= s.nextAt) this.run(p);
    }
  }

  minInterval(p) {
    return Math.max(p.minIntervalSec || 60, 1);
  }

  baseInterval(p) {
    return Math.max(this.pollIntervalSec, this.minInterval(p), p.intervalSec || 0);
  }

  /** 管理 API：立刻重抓（仍受 minIntervalSec 限制） */
  refreshNow() {
    const now = this.now();
    for (const p of this.providers) {
      const s = this.state[p.id];
      s.forbidden = false;
      s.nextAt = Math.max(now, s.lastAttemptAt + this.minInterval(p) * 1000);
    }
    this.touch();
    this.tick();
  }

  /**
   * 排程喚醒用（POST /api/push/tick）：各家抓一輪並等它們抓完，不算「有人在看」。
   * 仍遵守 minIntervalSec 與退避；剛抓過的就不再抓。
   * 沒人在看時每次喚醒都算一次新的「觀看期間」：403 再給一次機會，不然一次被擋就會停到有人打開網頁。
   */
  async pollOnce() {
    const now = this.now();
    const jobs = [];
    for (const p of this.providers) {
      const s = this.state[p.id];
      if (s.inflight) { jobs.push(s.inflight); continue; }
      if (!this.running) s.forbidden = false;
      if (s.forbidden) continue;
      if (now < s.nextAt || now < s.lastAttemptAt + this.minInterval(p) * 1000) continue;
      jobs.push(this.run(p));
    }
    await Promise.allSettled(jobs);
  }

  /** 憑證換新後：解除 auth 封鎖並盡快重抓 */
  credentialsChanged(id) {
    const p = this.providers.find((x) => x.id === id);
    if (!p) return;
    const s = this.state[id];
    s.authBlockedVersion = null;
    s.failures = 0;
    s.forbidden = false;
    s.nextAt = Math.max(this.now(), s.lastAttemptAt + this.minInterval(p) * 1000);
    if (this.running) this.tick();
  }

  status() {
    const out = {};
    for (const p of this.providers) {
      const s = this.state[p.id];
      out[p.id] = {
        configured: p.isConfigured(this.creds.all()),
        failures: s.failures,
        lastErrorKind: s.lastErrorKind || null,
        lastHttpStatus: s.lastHttpStatus || null,
        nextAt: s.nextAt ? new Date(s.nextAt).toISOString() : null,
        lastAttemptAt: s.lastAttemptAt ? new Date(s.lastAttemptAt).toISOString() : null,
        authBlocked: s.authBlockedVersion !== null,
        forbidden: s.forbidden,
      };
    }
    return { running: this.running, viewers: this.viewers, providers: out };
  }

  /** 抓一家；抓取中再被觸發就共用同一個 Promise */
  run(p) {
    const s = this.state[p.id];
    if (s.inflight) return s.inflight;
    s.inflight = this.#runOnce(p).finally(() => { s.inflight = null; });
    return s.inflight;
  }

  async #runOnce(p) {
    const s = this.state[p.id];
    const all = this.creds.all();

    if (!p.isConfigured(all)) {
      s.nextAt = this.now() + this.baseInterval(p) * 1000;
      if (this.snapshot.entry(p.id).status !== 'disabled') {
        this.#publish(p.id, { status: 'disabled', error: null });
      }
      return;
    }

    if (s.authBlockedVersion !== null && s.authBlockedVersion === this.creds.version(p.id)) {
      s.nextAt = this.now() + this.baseInterval(p) * 1000;
      return;
    }

    const started = this.now();
    s.lastAttemptAt = started;
    const versionAtStart = this.creds.version(p.id);
    let httpStatus = 200;
    try {
      const result = await p.fetch({
        creds: all,
        // 抓取途中憑證被換掉（管理 API）：舊流程續期拿到的 token 不能蓋掉新憑證
        saveCreds: (patch) => this.creds.save(p.id, patch, versionAtStart),
        withLock: (fn) => this.creds.withLock(p.id, fn),
      });
      const interval = this.baseInterval(p);
      s.failures = 0;
      s.lastErrorKind = null;
      s.lastHttpStatus = 200;
      s.nextAt = this.now() + interval * 1000;
      let windows = clearUnstartedResets(result.windows || [], this.now());
      if (this.forecaster) windows = this.forecaster.annotate(p.id, windows, this.now());
      this.#publish(p.id, {
        status: 'ok',
        plan: result.plan ?? this.snapshot.entry(p.id).plan,
        planExpiresAt: result.planExpiresAt ?? null,
        windows,
        balance: result.balance || null,
        note: result.note || null,
        error: null,
        slowed: false,
        intervalSec: interval,
        fetchedAt: new Date(this.now()).toISOString(),
        nextFetchAt: new Date(s.nextAt).toISOString(),
      });
    } catch (raw) {
      if (!(raw instanceof ProviderError)) {
        // 程式本身的錯（例如 TypeError）：只記錯誤種類與出錯位置，不記訊息（可能含回傳內容）
        logWarn('adapter 例外', { provider: p.id, err: raw?.name || typeof raw, at: errorSite(raw) });
      }
      const err = raw instanceof ProviderError ? raw : new ProviderError('parse', '處理回傳時出錯');
      httpStatus = err.httpStatus;
      s.failures += 1;
      s.lastErrorKind = err.kind;
      s.lastHttpStatus = err.httpStatus;
      this.#handleError(p, err, versionAtStart);
    } finally {
      logJson({
        provider: p.id,
        ok: s.lastErrorKind === null || s.lastErrorKind === undefined,
        ms: this.now() - started,
        httpStatus: httpStatus ?? null,
        errorKind: s.lastErrorKind || null,
      });
    }
  }

  #handleError(p, err, versionAtStart) {
    const s = this.state[p.id];
    const now = this.now();
    const base = this.baseInterval(p);
    const entry = this.snapshot.entry(p.id);
    const hasData = Boolean(entry.fetchedAt);
    let delaySec;
    let patch;

    switch (err.kind) {
      case 'rate_limit': {
        delaySec = err.retryAfterSec ?? Math.min(base * 2 ** s.failures, MAX_RATE_LIMIT_BACKOFF);
        delaySec = Math.max(delaySec, this.minInterval(p));
        // 重試時間由前端依 nextFetchAt 倒數顯示
        patch = hasData
          ? { status: 'ok', slowed: true, error: null }
          : { status: 'error', error: '429 請求太頻繁' };
        break;
      }
      case 'auth':
        delaySec = base;
        s.authBlockedVersion = versionAtStart;
        patch = { status: 'auth', error: '需要重新登入' };
        break;
      case 'forbidden':
        delaySec = base;
        s.forbidden = true;
        patch = { status: 'error', error: err.message };
        break;
      case 'parse':
        delaySec = PARSE_RETRY;
        patch = { status: 'error', error: err.message };
        break;
      case 'network':
      case 'upstream':
      default:
        delaySec = Math.min(base * 2 ** (s.failures - 1), MAX_ERROR_BACKOFF);
        patch = { status: 'error', error: err.message };
        break;
    }

    s.nextAt = now + delaySec * 1000;
    // 要重新登入、被擋的不會照時間重試（換憑證、下次有人看或排程喚醒才再試）：不給前端顯示重試時間
    const retryAt = err.kind === 'auth' || err.kind === 'forbidden' ? null : new Date(s.nextAt).toISOString();
    this.#publish(p.id, { ...patch, nextFetchAt: retryAt });
  }

  #publish(id, patch) {
    const view = this.snapshot.update(id, patch, this.now());
    this.broadcast('provider', view);
    this.snapshot.save();
  }
}

/** 錯誤堆疊裡第一個專案內的位置，例如 "src/providers/codex.js:42:7" */
export function errorSite(err) {
  const lines = String(err?.stack || '').split('\n').slice(1);
  for (const line of lines) {
    const m = /[\\/]((?:src[\\/][\w\\/.-]+|server)\.js):(\d+):(\d+)/.exec(line);
    if (m) return `${m[1].replace(/\\/g, '/')}:${m[2]}:${m[3]}`;
  }
  return null;
}

// 重置時間跟「現在＋整個週期」差不到這麼多，就當成還沒開始計時
const UNSTARTED_TOLERANCE_MS = 10 * 60_000;

/**
 * 還沒開始的額度：有些服務（Codex、Antigravity）在還沒用時照樣回一個重置時間＝「現在＋整個週期」，
 * 每次抓都往後推，看起來像永遠不會重置。已用 0% 而且重置時間剛好是一整個週期後，就把重置時間拿掉，
 * 前端會顯示「還沒用，用了才開始計時」。固定日期重置的（例如每月 1 號）不會剛好差一整個週期，不受影響。
 */
export function clearUnstartedResets(windows, now = Date.now()) {
  return windows.map((w) => {
    const period = Number(w.periodSec) * 1000;
    const left = Date.parse(w.resetsAt) - now;
    if (Number(w.usedPct) === 0 && period > 0 && Number.isFinite(left) && left >= period - UNSTARTED_TOLERANCE_MS) {
      return { ...w, resetsAt: null };
    }
    return w;
  });
}
