## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-05 - Avoid multiple passes for arrays
**Learning:** Using chained array methods like `.reduce` and `.map` is slow. Replacing them with Welford's online algorithm (for standard deviation calculation) and single-pass loops improves performance significantly. Batch trimming with `.splice()` is also faster than `.shift()`.
**Action:** Always prefer single-pass `for` loops and Welford's algorithm over chained array methods.
