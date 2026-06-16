
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.
## 2026-06-16 - Explicit Labeling vs Wrapping
**Learning:** For accessible forms, wrapping inputs inside labels works for simple layouts, but in complex grid layouts (like settings panels), using explicit `id` and `htmlFor` attributes on separate elements is more robust and necessary to maintain screen reader context without breaking CSS grids.
**Action:** Always prefer explicit `htmlFor` mappings for inputs in grid layouts to guarantee accessibility and layout stability.
