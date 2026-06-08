
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-06-08 - Stateful Icon Buttons Require Action-Oriented Labels
**Learning:** For stateful icon-only toggle buttons (like sound controls), screen readers need context on what interacting with the button will *do*, rather than just its current state. A static `aria-label="Sound settings"` is insufficient.
**Action:** Use dynamic `aria-label` values that describe the action (e.g., "Disable sound alerts" vs "Enable sound alerts") based on the current state.
