## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-07-04 - Optimization of Hot Loops
**Learning:** Recalculating totals across arrays on every insertion results in O(N^2) complexity, and object instantiation (e.g. `new Date()`) inside hot loops causes significant GC pauses.
**Action:** Use O(1) incremental state updates for running totals (remembering to rehydrate state in `fromJSON`), pre-calculate timestamps outside loops to use numeric comparison, and use Welford's online algorithm to calculate variance in a single pass instead of chained `reduce()` calls.
