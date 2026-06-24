## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-24 - Incremental state updates vs. repeated map/reduce
**Learning:** Recalculating totals with `reduce()` over an array on every insertion (e.g. `addTrade` recalculating `totalFilled`) causes O(N²) time complexity for N insertions, leading to severe slowdowns for long-running objects.
**Action:** Accumulate sums incrementally on each insertion (e.g. `this.filledAmount += trade.amount`) to keep insertion time at O(1).
