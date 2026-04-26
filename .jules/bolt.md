
## 2026-04-26 - [Algorithmic Optimizations in Array Iteration]
**Learning:** Common JavaScript array paradigms like chained `.filter().reduce()`, `Array.shift()`, and object spreading (`{ ...obj }`) can introduce significant performance bottlenecks (O(N²) complexity and high garbage collection overhead) when executed within high-frequency loops, such as those found in the BacktestEngine.
**Action:** When working in hot execution paths, replace these methods with single-pass `for` loops, use index pointers instead of destructive array manipulation, employ direct property assignment instead of object spreading, and leverage online algorithms (like Welford's) for single-pass variance and standard deviation calculations to maintain O(N) complexity and O(1) space.
