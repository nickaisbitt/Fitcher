## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-22 - Replaced O(N²) Array Operations
**Learning:** Replaced O(N) array method chains (`.map().filter().reduce()`), spread syntaxes (`Math.max(...arr)`), and `Array.shift()` with single-pass `for` loops and index tracking.
**Action:** Always prefer standard single-pass `for` loops over chained methods and index pointers over bulk deletions like `shift()` in hot code paths.
