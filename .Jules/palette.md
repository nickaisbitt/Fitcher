
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-06-10 - Accessible Heatmap Navigation
**Learning:** The compact heatmap grid uses abbreviations (e.g., 'BTC') and color coding to convey price movement, which completely excludes screen reader users from understanding the context or the asset's performance.
**Action:** Always include comprehensive `aria-label`s on visually compact data components (like heatmap buttons) that describe the full action and context (e.g., 'Select BTC/USD pair').
