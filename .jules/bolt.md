## 2026-04-19 - For-loops over `Array.prototype.reduce`
**Learning:** `Array.prototype.reduce` carries significant function overhead in tight statistical loops (computing mean, variance, moving averages) heavily called by components such as `strategyOptimizer.js` and `BacktestEngine.js`.
**Action:** Replace functional programming operations (like `.reduce()`) with native simple `for`-loops in performance critical areas, cutting out internal v8 function wrapper execution costs.

## 2026-04-19 - State-leakage in mutable arrays
**Learning:** Replacing `.slice()` with an incrementally maintained mutable buffer array (using `push` and `shift`) for providing snapshot data points inside `BacktestEngine` is dangerous because passing the same reference leaks the mutation side effects to the underlying components.
**Action:** Never replace `.slice()` for per-tick snapshots where the consumer assumes immutability.
