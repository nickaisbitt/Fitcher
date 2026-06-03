## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2024-05-06 - Optimizing Signal Aggregation & Metrics via 1-Pass Loops and Splice
**Learning:** Chained array methods (`.reduce`, `.map`) in `SignalAggregator.js` and `SmartOrderRouter.js` create significant GC thrashing in frequently evaluated loops. Additionally, continuously shifting arrays (e.g. `recentSignals.shift()`) has O(N) complexity per insert, significantly degrading performance over time.
**Action:** Replaced `.reduce` chains with single-pass `for` loops for weighted averages and standard deviations. Transitioned `.shift()` usage to batched `.splice()` operations, reducing array manipulation overhead by an order of magnitude.
