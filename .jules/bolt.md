## 2026-04-24 - Array.shift() and Object Spread in Hot Loops
**Learning:** Using `Array.shift()` and object spread (`...trade`) inside deeply nested while/for loops (like `calculateTradeStats`) causes O(N²) complexity and high GC overhead, severely impacting performance for large backtests.
**Action:** Replace `shift()` with an index pointer, assign specific properties directly instead of spreading, and aggregate in a single pass rather than filtering intermediate arrays.

## 2026-04-24 - Welford's Online Algorithm
**Learning:** Calculating variance by first mapping a returns array, computing the mean in one pass, and computing the variance in another pass causes unnecessary array allocations and takes 3 passes.
**Action:** Use Welford's online algorithm to compute the mean and variance simultaneously in a single O(N) pass without intermediate arrays.
