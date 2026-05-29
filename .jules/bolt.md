## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-05-29 - Array Reduce Math Computations
**Learning:** Chained `.reduce()` arrays used for Standard Deviation, Variance, and Sharpe ratio calculations in tight hotpaths create massive O(N) GC and intermediate arrays, taking over 510ms for 1k variance executions over 10k items. Using Welford's online algorithm and single-pass loops drops this overhead to under 100ms. Continuous `.shift()` on IndicatorState arrays can be replaced with amortized batch `.splice()`.
**Action:** Always favor robust online single-pass algorithms like Welford's over simplistic reduce calculations for rolling stats in heavy node pipelines.
