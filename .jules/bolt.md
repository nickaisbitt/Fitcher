## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-06-26 - TypedArrays and online algorithms
**Learning:** Chaining array methods like .map(), .filter(), and .reduce() in hot loops significantly degrades performance due to intermediate array allocation and repeated iterations. Standard arrays for numerical stats perform poorly compared to TypedArrays.
**Action:** When identifying multiple array passes (especially for statistics or aggregations), replace them with a single `for` loop, utilizing `Float64Array` where typing is strict and using robust single-pass algorithms like Welford's online variance calculation to ensure numerical stability and minimize GC pressure.
