// Bounded-concurrency Promise.all.
// Runs `worker(item)` for each item, limiting concurrent in-flight tasks to `limit`.
export const pAll = async (items, limit, worker) => {
    const results = new Array(items.length);
    let next = 0;
    const lanes = [];
    const n = Math.min(limit, items.length);
    for (let i = 0; i < n; i++) {
        lanes.push((async () => {
            while (true) {
                const idx = next++;
                if (idx >= items.length)
                    return;
                results[idx] = await worker(items[idx], idx);
            }
        })());
    }
    await Promise.all(lanes);
    return results;
};
//# sourceMappingURL=p-all.js.map