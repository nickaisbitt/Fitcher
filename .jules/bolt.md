## 2024-05-06 - Replacing O(N²) array operations
**Learning:** Heavy use of `Array.shift()`, object spreading (`...obj`), and multiple `.reduce()` chained loops within `for` loops in Node.js creates significant GC thrashing and O(N²) complexity loops, forming a substantial bottleneck on performance paths like BacktestEngine execution.
**Action:** Replace `.shift()` with index pointers, `.splice()` for bulk deletion, and replace `.reduce()`/`.filter()` chaining with single pass loops.

## 2026-06-27 - Array.reduce Performance Bottleneck in Hot Loops
**Learning:** Chained array methods like `.reduce()` and `.map()` cause a massive performance hit due to callback allocation and iteration overhead (up to 15x slower). In frequently executed methods like standard deviation, variance, and latency stats calculation, these micro-delays add up significantly.
**Action:** Replace `.reduce()` and `.map()` with standard single-pass `for` loops and accumulator variables in mathematically intensive paths.
