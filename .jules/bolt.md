## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2024-07-28 - O(N²) Accumulation in Model Methods
**Learning:** Recomputing cumulative values (like `totalFilled` and `averagePrice`) using `reduce()` over growing arrays inside model methods (e.g., `Order.addTrade`) causes unexpected O(N²) scaling and degrades performance under load.
**Action:** Replace `reduce()` with O(1) incremental state updates on the model instance (e.g., `this._totalValue += trade.amount * trade.price`) and ensure `fromJSON` properly hydrates this state to prevent downstream `NaN` errors.
