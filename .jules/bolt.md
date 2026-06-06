## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-06 - Replacing Math.max/min spread and multiple reduce calls
**Learning:** Using spread syntax inside `Math.max(...array)` or chaining `.map()` followed by `.reduce()` creates hidden performance bottlenecks in hot paths. Iterating twice to calculate mean and variance using `.reduce()` in Node.js incurs high overhead compared to native mathematical optimizations.
**Action:** Replace spread operators and `.map()` with single-pass `for` loops. Use Welford's online algorithm to calculate mean and variance simultaneously in a single pass for a ~40% speedup.
