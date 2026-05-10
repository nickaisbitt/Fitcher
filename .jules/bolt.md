## 2026-05-10 - Anti-Pattern: Chained Array Operations in Hot Loops
**Learning:** Found widespread use of chained array methods (`.filter().map().reduce()`) for metrics calculation and O(N) `Array.shift()` for continuous trimming. These create significant garbage collection overhead and O(N^2) complexity in stateful streaming modules.
**Action:** Replaced chained iterators with single-pass `for` loops, replaced continuous trimming with threshold-based batch `Array.splice()`, and implemented Welford's online algorithm to compute variance dynamically without multiple array iterations.
