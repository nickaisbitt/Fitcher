## 2026-05-20 - Array Processing Overhead
**Learning:** Chained array methods (`.filter()`, `.map()`, `.reduce()`) introduce heavy object allocation and Garbage Collection pressure in hot paths (like `MetricsCollector` latency gathering or `SmartOrderRouter` orderbook processing).
**Action:** Always prefer standard `for` loops and pre-allocated `Float64Array` buffers for high-frequency numerical analysis to eliminate intermediate arrays and avoid catastrophic GC spikes.
