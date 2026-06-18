## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-18 - Pre-allocating Float64Array for numeric metrics
**Learning:** Using `.map().sort()` for computing latency metrics creates significant intermediate object overhead. Pre-allocating a `Float64Array` and populating it via a standard loop before sorting provides roughly a 6x speedup.
**Action:** When calculating numeric distributions (like p95/p99) on large datasets in hot paths, pre-allocate a TypedArray instead of mapping to standard JS arrays.
