import { ProviderError } from './errors.js';
import { logJson, logInfo } from './log.js';

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
  constructor({ providers, creds, snapshot, broadcast, pollIntervalSec, idleGraceSec, now = Date.now, random = Math.random }) {
    this.providers = providers;
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
        saveCreds: (patch) => this.creds.save(p.id, patch),
        withLock: (fn) => this.creds.withLock(p.id, fn),
      });
      const interval = this.baseInterval(p);
      s.failures = 0;
      s.lastErrorKind = null;
      s.lastHttpStatus = 200;
      s.nextAt = this.now() + interval * 1000;
      this.#publish(p.id, {
        status: 'ok',
        plan: result.plan ?? this.snapshot.entry(p.id).plan,
        windows: result.windows || [],
        balance: result.balance || null,
        note: result.note || null,
        error: null,
        slowed: false,
        intervalSec: interval,
        fetchedAt: new Date(this.now()).toISOString(),
        nextFetchAt: new Date(s.nextAt).toISOString(),
      });
    } catch (raw) {
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
        const mins = Math.max(1, Math.round(delaySec / 60));
        patch = hasData
          ? { status: 'ok', slowed: true, error: null }
          : { status: 'error', error: `429 請求太頻繁，${mins} 分鐘後重試` };
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
    this.#publish(p.id, { ...patch, nextFetchAt: new Date(s.nextAt).toISOString() });
  }

  #publish(id, patch) {
    const view = this.snapshot.update(id, patch, this.now());
    this.broadcast('provider', view);
    this.snapshot.save();
  }
}
