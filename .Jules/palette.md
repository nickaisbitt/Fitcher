
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-07-03 - Dynamic ARIA Labels for Stateful Icon Buttons
**Learning:** For stateful icon-only toggle buttons (like the sound control), screen readers need to understand the *action* that will happen when clicked, not just the current visual state.
**Action:** Use dynamic `aria-label` attributes that change based on state (e.g., `aria-label={settings.soundEnabled ? 'Disable sound alerts' : 'Enable sound alerts'}`) to provide accurate context.
