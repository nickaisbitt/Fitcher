## 2026-05-01 - O(N²) Arrays in BacktestEngine and MetricsCollector
**Learning:** `Array.shift()` and `...trade` (object spreading) within nested loops during data processing (`calculateTradeStats`, `trimOldData`, `recordEquity`) created significant O(N²) time complexity constraints that limited throughput on large market datasets. Furthermore, chaining array iterations via `.filter().reduce()` allocated intermediate arrays that strained the Garbage Collector.
**Action:** Replace `Array.shift()` inside loops with index pointers (`openBuysHead++`) or bulk mutations (`Array.splice()`). Avoid object spreading in hot paths in favor of direct property assignments. Finally, collapse `.filter()` and `.reduce()` operations into single-pass `for` loops.

## 2026-05-01 - Welford's Online Algorithm for Variance Calculation
**Learning:** Calculating variance using chained `.reduce()` methods creates an unnecessary intermediate `returns` array per tick. In scenarios processing thousands of candles continuously in `calculateExecutionPrice` and `calculateSharpeRatio`, these allocations create high memory overhead.
**Action:** Always compute mean and variance in a single pass using Welford's online algorithm inside a standard `for` loop, eliminating array allocations and iteration overhead entirely.
