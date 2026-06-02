
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-11-20 - Custom Focus States for Keyboard Navigation
**Learning:** Default browser focus rings are often obscured or clash with custom dark themes, making keyboard navigation difficult. Using Tailwind's `focus-visible` utility is crucial for providing clear, accessible focus indicators without affecting mouse users.
**Action:** When adding interactive elements (buttons, custom tabs, list items acting as buttons), always append `focus-visible:ring-2 focus-visible:ring-[color] focus:outline-none` to ensure keyboard accessibility.
