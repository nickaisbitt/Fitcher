## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-05-18 - Replacing chained array methods and dynamic object creation loops
**Learning:** Frequent array creation through `.filter()`, `.reduce()`, and `Array.from()` inside inner loops, like those in `PositionManager` and `GridTradingStrategyV2`, cause excessive intermediate array instantiation and GC pressure.
**Action:** Always replace chained array operations and dynamic array conversions (e.g. `Array.from().reduce()`) inside loops with direct `for...of` or standard `for` loops summing variables directly.
