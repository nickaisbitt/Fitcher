
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-07-04 - Explicit Label Associations Needed
**Learning:** In the inline React application compiled via Babel, standard JSX `htmlFor` and `id` attributes must be explicitly and strictly applied to all label/input pairs to maintain screen reader accessibility. Visually grouping inputs is not enough.
**Action:** Ensure all inputs, including ranges and numbers, have corresponding `id`s and `htmlFor` labels even if they are nested within a container visually.
