## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2024-05-13 - Replacing O(N) array shifts in hot paths with threshold-based batched array splice
**Learning:** Calling `Array.prototype.shift()` on every tick in sliding windows or cache arrays (like indicator buffers or signal caches) triggers a re-indexing of the entire array, resulting in O(N) complexity per operation which creates significant CPU overhead in hot loops like BacktestEngine and Indicator updates.
**Action:** Replace `Array.prototype.shift()` with threshold-based batched `Array.prototype.splice()` operations. When maintaining mathematical moving averages, switch to accessing out-of-bounds elements via index calculation (e.g., `state.buffer[state.buffer.length - 1 - period]`) instead of `shift()` to maintain O(1) amortized performance.

## 2024-05-13 - Calculating Variance via Welford's Algorithm
**Learning:** Calculating array variance with a `.reduce()` loop to find the mean, followed by a second `.reduce()` loop for sum of squared differences, involves iterating over the array twice (O(2N)).
**Action:** Replace multiple-pass variance calculations with Welford's online algorithm in a single `for` loop to reduce complexity to O(N) while inherently improving floating-point numerical stability for statistical outputs like Sharpe Ratios.

## 2024-05-13 - Loop Fusion in Array Methods
**Learning:** Chaining functional array methods like `.map()`, `.filter()`, and `.reduce()` repeatedly iterates over the same array multiple times and spawns intermediate array allocations, killing performance in high-frequency trading aggregators.
**Action:** Consolidate multiple chained functional methods into a single imperative `for` loop (loop fusion) to significantly reduce array traversals and garbage collection pauses.
