## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-19 - Pre-allocating TypedArrays in stat gathering
**Learning:** In performance-sensitive latency stats calculation paths, gathering values array using map then chaining an array reduce, creates excessive object allocations.
**Action:** Use pre-allocated TypedArrays like new Float64Array(length) and a simple for loop to greatly reduce heap pressure.
