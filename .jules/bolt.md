## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-04 - math instability and pre-allocated arrays
**Learning:** Using a two-pass algorithm for variance calculation is slow and susceptible to catastrophic cancellation. Using .map().sort() creates unnecessary objects in hot paths.
**Action:** Replace .map().sort() with pre-allocated arrays (e.g., `Float64Array`). Use Welford's online algorithm for robust 1-pass variance and standard deviation calculations.
