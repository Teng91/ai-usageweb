import claude from './claude.js';
import codex from './codex.js';
import antigravity from './antigravity.js';
import copilot from './copilot.js';
import openrouter from './openrouter.js';

// 固定顯示順序
export const ALL_PROVIDERS = [claude, antigravity, codex, copilot, openrouter];

export function loadProviders(enabled = []) {
  if (!enabled.length) return ALL_PROVIDERS;
  const set = new Set(enabled);
  return ALL_PROVIDERS.filter((p) => set.has(p.id));
}
