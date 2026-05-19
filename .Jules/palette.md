
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-10-25 - Error Prevention for Destructive Actions
**Learning:** Destructive actions like closing a trading position were executed immediately on click without any confirmation, which could lead to accidental losses if users misclick.
**Action:** Always wrap destructive trading actions (like selling/closing positions or deleting data) with a confirmation dialog (e.g., `window.confirm`) to introduce a safe friction point and prevent accidental clicks. Add visual focus rings to ensure keyboard users can safely navigate these controls.
