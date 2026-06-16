## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-16 - Replaced O(N) array loops with Welford's algorithm
**Learning:** Standard mean/variance loops require two passes and can be susceptible to catastrophic cancellation. Multiple .reduce() and .map() method chains lead to O(N) complexity for operations that could be combined into single-pass performance-friendly loops.
**Action:** Use Welford's one-pass algorithm to calculate variance for better performance. Use single-pass for loops instead of chained iterator methods.
