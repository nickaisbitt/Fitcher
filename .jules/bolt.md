## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-05-22 - Replacing Chained Array Methods
**Learning:** Chained array methods like `.map().reduce().filter()` and sorting un-mapped object arrays create severe garbage collection pressure and intermediate array allocations, reducing runtime performance to O(N * #methods).
**Action:** Replace chained iterators with single-pass `for` loops in performance-critical paths (e.g., SignalAggregator). For metrics sorting, map values directly to a `Float64Array` prior to sorting to avoid GC overhead entirely. Use Welford's online algorithm for computing variance in a single pass instead of pushing returns to an array and doing a 2-pass mean/variance loop.
