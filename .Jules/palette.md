
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-07-07 - Accessible Compact Forms
**Learning:** In visually compact forms across this app (like the Mode & Exchange settings), input fields often lack visible labels to save space, breaking screen reader accessibility.
**Action:** Use Tailwind's `sr-only` class on explicit `<label>` elements linked to inputs via `htmlFor` to provide essential screen reader context without altering the compact visual design.
