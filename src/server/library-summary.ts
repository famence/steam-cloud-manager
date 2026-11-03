import type { CloudDriver } from './steam/contracts.js';
import { AppError } from './errors.js';
import type { GameSummary } from '../shared/types.js';
/** Per-account, bounded, short-lived metadata cache. Never used to authorize a deletion. */
export class LibrarySummaryCache {
  private readonly accounts = new WeakMap<CloudDriver, {
    values: Map<number, { until: number; value: GameSummary }>;
    pending: Map<number, Promise<GameSummary>>;
  }>();
  constructor(private readonly now: () => number = Date.now) {}
  async get(driver: CloudDriver, appId: number): Promise<GameSummary> {
    let state = this.accounts.get(driver);
    if (!state) { state = { values: new Map(), pending: new Map() }; this.accounts.set(driver, state); }
    const cached = state.values.get(appId);
    if (cached && cached.until > this.now()) return cached.value;
    const existing = state.pending.get(appId);
    if (existing) return existing;
    if (state.pending.size >= 2) throw new AppError(429, 'SUMMARY_BUSY', 'Cloud checks are busy.');
    const pending = (async () => {
      const listing = await driver.listFiles(appId);
      const value: GameSummary = { appId, fileCount: listing.files.length,
        totalBytes: listing.files.reduce((sum, file) => sum + file.size, 0) };
      if (state!.values.size >= 1000) state!.values.delete(state!.values.keys().next().value!);
      state!.values.set(appId, { until: this.now() + 60_000, value });
      return value;
    })();
    state.pending.set(appId, pending);
    try { return await pending; } finally { state.pending.delete(appId); }
  }
  invalidate(driver: CloudDriver, appId: number): void { this.accounts.get(driver)?.values.delete(appId); }
}
