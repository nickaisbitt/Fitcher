## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2024-05-16 - Replacing Array methods and using TypedArrays for hot loops
**Learning:** Chaining array methods like `.filter()`, `.map()`, and `.reduce()` in aggregation or hot paths creates huge memory overhead and GC pressure. When converting lists to numbers for mathematical operations (like sorting latency), using standard arrays leads to catastrophic performance.
**Action:** Replace chained array methods with single-pass `for` loops. Pre-allocate and use `Float64Array` instead of mapping over objects for numeric intensive operations like large sorts. For statistics like Standard Deviation, prefer 1-pass Welford's algorithm over 2-pass `.reduce()`.
