## 2024-05-18 - [O(n²) Array Deduplication and O(N) Cache Lookups]
**Learning:** Found two common codebase-specific performance anti-patterns:
1. Deduplicating a sorted array using `filter` + `findIndex` leads to `O(n²)` complexity (`historicalDataService.js`), which is catastrophic for time-series data like OHLCV candles. A linear scan is `O(n)`.
2. Retrieving data for a specific pair from a global cache (`marketDataAggregator.js`) was done by iterating over ALL entries in the cache (`Map.entries()`), effectively making it `O(N)` instead of `O(E)` (where N is total pairs*exchanges and E is just the active exchanges). Additionally, `.includes()` on keys is not only slow but error-prone.
**Action:** Always leverage exact known keys (e.g. `exchangeName` from `this.exchanges`) to query Maps directly instead of iterating them, and use single-pass linear scans for deduplicating already sorted arrays.
