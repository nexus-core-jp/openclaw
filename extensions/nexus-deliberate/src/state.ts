/**
 * In-memory deliberation state management.
 * Phase B will migrate to persistent storage.
 *
 * Eviction は timestamp ベースで最古のエントリを削除（P2-1 修正）。
 */

import type { DeliberationResult } from "./types.js";

const MAX_STORED = 100;

const store = new Map<string, DeliberationResult>();

export function saveResult(result: DeliberationResult): void {
  store.set(result.id, result);

  // Evict oldest entries beyond limit (timestamp-based)
  if (store.size > MAX_STORED) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, r] of store) {
      const ts = new Date(r.timestamp).getTime();
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestId = id;
      }
    }
    if (oldestId !== null) {
      store.delete(oldestId);
    }
  }
}

export function getResult(id: string): DeliberationResult | undefined {
  return store.get(id);
}

export function listResults(limit: number = 20): DeliberationResult[] {
  const all = Array.from(store.values());
  // Sort by timestamp descending, return most recent
  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return all.slice(0, limit);
}
