/**
 * Map over items with at most `limit` in flight.
 *
 * Fanning out one request per channel is fine for the two or three a device
 * usually has and wrong for the sixty-four the schema permits: every series
 * request takes a gateway session and a lease on a five-client pool, so an
 * unbounded fan-out exhausts the pool and turns healthy channels into
 * per-card failures. Results keep the input order regardless of completion
 * order, so the plots stay in channel order.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (limit < 1) throw new Error("concurrency limit must be at least 1");
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
