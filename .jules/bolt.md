## 2026-04-21 - Trade Matcher N² Scaling Regression
**Learning:** Attempting to eliminate cloning by replacing openBuys object spreading logic with shared tracking array and split loops will break lookahead boundaries, allowing future events to retroactively affect trade matches. O(N²) array shifting loops can only be safely rewritten to O(N) by applying pointers *inside* the existing bounds.
**Action:** Maintain chronological integrity of backtesting logic when replacing inefficient array operations; logic optimizations must be bound to sequential contexts.
