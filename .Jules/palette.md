
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## $(date +%Y-%m-%d) - Actionable Empty States
**Learning:** Text-only empty states in data-heavy components (like Scanner and Optimizer tabs) lead to dead-ends.
**Action:** When designing empty states for data-heavy components in this application's UI, adhere to the established reusable UX pattern: a large icon (e.g., `text-4xl`), a prominent title (`font-semibold`), a descriptive subtitle (`text-gray-400 max-w-sm`), and a clear Call-To-Action (CTA) button.
