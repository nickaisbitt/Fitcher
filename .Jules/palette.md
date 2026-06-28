
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-06-28 - Actionable Empty States and Dynamic ARIA Labels
**Learning:** Text-only empty states represent missed opportunities to guide users, and stateful toggle buttons require dynamic descriptions.
**Action:** Replace empty texts like "No open position" or "No activity" with a visual component containing an icon, descriptive text, and a clear Call-To-Action (CTA) if applicable. For stateful icon buttons (e.g. sound toggle), dynamically update the `aria-label` to describe the action ("Enable" vs "Disable") rather than the current state.
