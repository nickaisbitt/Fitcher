## 2024-04-29 - [Initial Note]
**Learning:** Initial memory check: O(N²) issues with `.shift()` and array destructuring in hot paths are common patterns to optimize in this codebase.
**Action:** Replace `.shift()` loops with simple pointers when iterating, and be careful with immutability.
