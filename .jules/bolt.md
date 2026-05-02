## 2026-05-02 - Eliminate array `shift()` O(N²) in hot paths
**Learning:** In real-time high-throughput systems, using `Array.shift()` to keep a sliding window on a large array (like 1000 items) turns into an O(N²) reallocation cost on every tick.
**Action:** Replace 1-by-1 `shift()` calls with batched trimming using `Array.splice()` (e.g. `if (length > 1200) splice(0, length - 1000)`) to drastically lower garbage collection and CPU overhead in the main thread.
