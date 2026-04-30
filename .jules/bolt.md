## 2026-04-30 - Array methods scaling in JS
**Learning:** Chained array methods (.filter().reduce()) and O(N) array shifts (.shift()) cause significant N^2 performance degradation when processing historical order data.
**Action:** Use Welford's algorithm for variance calculation, index pointers instead of .shift() for queues, and batched Array.splice() for sliding memory cleanup windows.
