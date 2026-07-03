## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2026-07-03 - O(N²) array bottlenecks and GC thrashing
**Learning:** Using `Array.reduce()` and `Array.shift()` inside hot paths (e.g., handling 1000s of trades or 100k candles) leads to severe performance degradation due to O(N²) complexity and GC thrashing from array re-allocations.
**Action:** Replace `Array.shift()` in moving averages/bands with fixed-size modulo ring buffers (`buffer = new Array(period); head = (head + 1) % period`). Replace `Array.reduce()` inside `Order.addTrade` with O(1) incremental state tracking, and replace chained `.map().reduce()` with single-pass `for` loops or Welford's algorithm for math aggregations.
