
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.
## $(date +%Y-%m-%d) - Action-Oriented ARIA Labels for Toggle Buttons
**Learning:** For stateful icon-only toggle buttons (like a sound toggle), an `aria-label` describing the *action* (e.g., "Enable sound alerts" vs "Disable sound alerts") is much clearer for screen reader users than simply describing the current state.
**Action:** When adding accessibility to toggle buttons, dynamically set the `aria-label` based on the state to explicitly state the action the button will perform when clicked.
