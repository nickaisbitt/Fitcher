## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
## 2026-06-15 - Optimize hot loops
**Learning:** Chained array methods (.map().filter().reduce()) and creating objects via spreading in Node.js loops create significant garbage collection overhead and reduce performance in hot paths.
**Action:** Replace them with single pass standard for loops and pre-allocated TypedArrays for better performance.
