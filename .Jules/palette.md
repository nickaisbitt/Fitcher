
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-06-11 - Use `sr-only` for Accessible Form Labels in Compact Layouts
**Learning:** When designing visually compact UI elements (like API key inputs in an inline settings dropdown), removing visible labels can hurt accessibility for screen reader users.
**Action:** Use Tailwind's `sr-only` class on explicitly linked `<label>` elements (`htmlFor` matching input `id`) to maintain full screen reader context without disrupting the dense visual layout.
