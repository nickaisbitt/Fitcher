
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-11-21 - Contextual Empty States Provide System Transparency
**Learning:** In continuous automated processes (like trading bots), an empty state when running (e.g., "Bot is actively monitoring...") provides critical reassurance compared to a generic "No position" message. Context-aware empty states improve system transparency.
**Action:** When designing empty states for dynamic systems, always fork the state based on the system's operational status (e.g., stopped vs. running) to provide accurate user guidance.
