## 2024-05-07 - Welford's Algorithm vs Multi-Pass Variance
**Learning:** In hot loops like `calculateSlippage` in `BacktestEngine`, slicing arrays and doing multi-pass `.reduce()` for mean and variance causes O(N^2) complexity and enormous garbage collection overhead, bottlenecking the entire backtest engine.
**Action:** Replace all rolling variance and standard deviation calculations in performance-critical paths with Welford's online algorithm, computing the variance in a single O(N) pass without array allocations.
