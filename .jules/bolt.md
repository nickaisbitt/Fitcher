## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-29 - Array operations scaling limitations
**Learning:** Chaining array methods like map/reduce in tight loops degrades execution performance, particularly on long-running objects scaling towards O(N²) when operating inside an iterative data insertion logic, e.g., trade arrays in `Order` models. Relying on simple, unchained O(1) state increments or Welford's online algorithm for standard deviations vastly improves execution speed and efficiency.
**Action:** Use simple state increments or O(n) math algorithms instead of recalculating statistics across complete arrays on every tick.
