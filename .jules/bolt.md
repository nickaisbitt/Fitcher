## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-07-01 - Object model array looping vs O(1) variables
**Learning:** Using chained array `.reduce()` calls on object history arrays (like `order.trades`) to calculate metrics dynamically on every insertion degrades performance to O(N²) for long-running objects.
**Action:** Accumulate state incrementally using variables like `_totalValue` instead of recalculating on insertion, reducing complexity to O(1).
