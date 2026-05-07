## 2026-05-07 - Array shifting in data retention loops causes O(N²) bottlenecks
**Learning:** Using `Array.shift()` inside a `while` loop to enforce retention policies or max sizes creates a significant O(N²) bottleneck, as every shift forces re-indexing of the entire array.
**Action:** When trimming rolling buffers or data arrays in performance-critical sections like `metricsCollector.js` or `marketDataAggregator.js`, use a single-pass `Array.splice()` after finding the correct boundary index, or use a fixed-size circular buffer.
