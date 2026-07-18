// Bounded-concurrency Promise.all.
// Runs `worker(item)` for each item, limiting concurrent in-flight tasks to `limit`.

export const pAll = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes: Promise<void>[] = [];
  const n = Math.min(limit, items.length);
  for (let i = 0; i < n; i++) {
    lanes.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx]!, idx);
      }
    })());
  }
  await Promise.all(lanes);
  return results;
};
