
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2026-05-21 - Keyboard Accessibility Focus Styles
**Learning:** For frontend keyboard accessibility in the React app, the established design pattern is to use Tailwind's `focus-visible` utility classes to provide clear focus indicators without disrupting mouse navigation.
**Action:** Always append `focus-visible:ring-2 focus-visible:ring-cyan-500 focus:outline-none` to interactive elements like buttons and toggle switches to ensure screen reader and keyboard users can navigate effectively.
