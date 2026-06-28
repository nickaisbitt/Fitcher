## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-28 - Optimizing Array Reductions
**Learning:** Replacing chained array reductions like .reduce() or .map().sort() with standard for-loops or one-pass algorithms (like Welford's online algorithm) and TypedArrays (Float64Array) dramatically reduces CPU overhead, GC pressure, and significantly speeds up performance.
**Action:** Avoid .reduce() chaining for calculations (e.g. variance or sums) in hot loops. Preallocate typed arrays for latency or heavy numeric metrics where possible.
