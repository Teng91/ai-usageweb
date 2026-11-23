/** SSE 連線管理：ping、廣播、連線上限時間 */
export class SseHub {
  constructor({ pingSec = 25, maxAgeSec = 1800, onJoin = () => {}, onLeave = () => {} } = {}) {
    this.clients = new Set();
    this.pingSec = pingSec;
    this.maxAgeSec = maxAgeSec;
    this.onJoin = onJoin;
    this.onLeave = onLeave;
    this.pingTimer = null;
  }

  get count() {
    return this.clients.size;
  }

  add(req, res, initialSnapshot) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client = { res, connectedAt: Date.now() };
    this.clients.add(client);
    this.send(client, 'snapshot', initialSnapshot);

    // 保險：同一條連線開太久就請前端在「看得見」時才重連，避免忘了關的分頁讓機器一直開著
    client.maxAgeTimer = setTimeout(() => {
      this.send(client, 'bye', { reason: 'max-age' });
      res.end();
    }, this.maxAgeSec * 1000);
    client.maxAgeTimer.unref?.();

    const cleanup = () => {
      if (!this.clients.has(client)) return;
      clearTimeout(client.maxAgeTimer);
      this.clients.delete(client);
      this.onLeave(this.clients.size);
      if (this.clients.size === 0) this.stopPing();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    this.startPing();
    this.onJoin(this.clients.size);
  }

  send(client, event, data) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // 連線已斷，cleanup 會處理
    }
  }

  broadcast(event, data) {
    for (const c of this.clients) this.send(c, event, data);
  }

  startPing() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const c of this.clients) {
        try { c.res.write(': ping\n\n'); } catch { /* ignore */ }
      }
    }, this.pingSec * 1000);
    this.pingTimer.unref?.();
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  closeAll() {
    for (const c of [...this.clients]) {
      this.send(c, 'bye', { reason: 'shutdown' });
      try { c.res.end(); } catch { /* ignore */ }
    }
    this.stopPing();
  }
}
