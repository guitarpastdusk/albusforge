/**
 * A sliding-window limiter held in memory, per instance. Defence in depth
 * behind Cloud Armor's per-IP rules: with N gateway instances a caller can get
 * up to N × limit, and a restart forgets every window.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private takes = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns 0, or returns the milliseconds until one is allowed without recording. */
  take(key: string): number {
    const now = this.now();
    if (++this.takes % 1000 === 0) this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return recent[0]! + this.windowMs - now;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  /** Drops keys with no hit inside the window, so memory tracks active callers only. */
  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
