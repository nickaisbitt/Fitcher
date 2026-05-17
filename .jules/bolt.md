## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.
## 2024-05-17 - Avoiding GC Thrashing and O(N) penalties in Hot Loops
**Learning:** Using `Array.shift()` on long indicator buffers incurs a heavy O(N) array re-indexing penalty per tick. In addition, heavily chaining `.reduce()` calls and pushing to untyped arrays creates excessive GC thrashing during math-heavy paths like backtesting or risk simulation.
**Action:** Replace continuous single-element trimming (`shift`) with threshold-based batch trimming (`splice`). Replace chained `.reduce()` calls with standard `for` loops, and use `Float64Array` instead of standard JS arrays when storing sequential float data (like daily returns).
