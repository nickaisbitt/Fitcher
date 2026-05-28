## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2024-05-18 - Consolidating Map/Filter/Reduce chains into Single-Pass Loops
**Learning:** Frequent chaining of `.map().filter().reduce()` or `.slice().map()` in core services like `SignalAggregator`, `metricsCollector`, `MultiTimeframeIndicatorState`, and `positionManager` introduces multiple full-array iterations and intermediate array allocations, causing performance bottlenecks and excess garbage collection.
**Action:** Replace chained higher-order array methods with standard, single-pass `for` loops (using basic variables for tracking sums, max/min, or counts) in performance-critical calculation blocks.
