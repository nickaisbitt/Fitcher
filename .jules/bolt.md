## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-20 - Optimize loop calculations
**Learning:** Using chained array methods like `.map().sort()` or `.reduce()` inside tight loops for metrics like average and standard deviation creates high GC overhead and CPU usage. Calculating mean and variance can be done with a single-pass loop utilizing Welford's online algorithm. Pre-allocating a `Float64Array` significantly improves array sorting performance.
**Action:** Replace `.reduce()` with standard `for` loops and Welford's online algorithm. Use pre-allocated `Float64Array` when sorting numbers.
