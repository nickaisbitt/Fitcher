## 2026-04-22 - Replacing N-pass Array Methods with Single-Pass Algorithms in Hot Loops
**Learning:** Chained array methods (`.filter().reduce()`), `Array.shift()`, and repeated calculation passes (e.g., computing mean then variance) create severe O(N) or O(N²) bottlenecks in tight simulation loops like `BacktestEngine`.
**Action:** Replace `Array.shift()` on arrays with an index pointer, remove intermediate array creation/spreading, and use Welford's online algorithm to calculate mean and variance in a single O(N) pass.
