import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers.js';
import { HistoryStore, dayKey } from '../src/history.js';

test('history: 依指定時區分天（台灣時間 00:30 算當天）', () => {
  // UTC 11/23 16:30 = 台灣 11/24 00:30
  assert.equal(dayKey(Date.parse('2026-11-23T16:30:00Z'), 'Asia/Taipei'), '2026-11-24');
  assert.equal(dayKey(Date.parse('2026-11-23T16:30:00Z'), 'UTC'), '2026-11-23');
});

test('history: 每個窗口記當天最高的已用 %，餘額記最後一次', () => {
  let t = Date.parse('2026-11-24T02:00:00Z');
  const h = new HistoryStore({ dataDir: tmpDir(), now: () => t });
  h.record('claude', { windows: [{ id: '5h', usedPct: 30 }, { id: '7d', usedPct: 10 }] });
  t += 60_000;
  h.record('claude', { windows: [{ id: '5h', usedPct: 12.34 }, { id: '7d', usedPct: 11 }] }); // 5h 重置後變低
  h.record('openrouter', { windows: [], balance: { remaining: 3.456 } });
  h.record('openrouter', { windows: [], balance: { remaining: -0.2 } });
  const v = h.view();
  assert.equal(v.tz, 'Asia/Taipei');
  assert.equal(v.today, '2026-11-24');
  assert.deepEqual(v.days, [{ date: '2026-11-24', providers: { claude: { '5h': 30, '7d': 11 }, openrouter: { $balance: -0.2 } } }]);
});

test('history: 只保留 45 天，view 只回最近 n 天、由舊到新', () => {
  let t = Date.parse('2026-01-01T04:00:00Z');
  const h = new HistoryStore({ dataDir: tmpDir(), now: () => t });
  for (let i = 0; i < 50; i++) {
    h.record('codex', { windows: [{ id: 'primary', usedPct: i }] });
    t += 86_400_000;
  }
  assert.equal(Object.keys(h.days).length, 45);
  const v = h.view(30);
  assert.equal(v.days.length, 30);
  assert.equal(v.days.at(-1).providers.codex.primary, 49);
  assert.ok(v.days[0].date < v.days[1].date);
});

test('history: 存檔後重新載入；格式不對的檔案不用', async () => {
  const dir = tmpDir();
  const t = Date.parse('2026-11-24T02:00:00Z');
  const h = new HistoryStore({ dataDir: dir, now: () => t });
  h.record('copilot', { windows: [{ id: 'chat', usedPct: 1 }] });
  await h.save();
  const h2 = await new HistoryStore({ dataDir: dir, now: () => t }).load();
  assert.equal(h2.view().days[0].providers.copilot.chat, 1);
});
