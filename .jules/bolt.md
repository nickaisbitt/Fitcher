## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-07-06 - Optimize chained methods and Array.shift()
**Learning:** Chained array methods (`.filter().map().reduce()`) and `Array.shift()` arrays inside loops cause severe O(N²) garbage collection thrashing in hot paths like BacktestEngine and IndicatorState. Fixed-size ring buffers (`buffer[head]`) and single-pass `for` loops provide a massive ~10x performance boost (measured via `performance.now()`).
**Action:** Always prefer standard `for` loops and index-pointer ring buffers over array manipulation (like `shift()` or chaining) when accumulating data across intervals or rolling timeframes in high-frequency functions.
