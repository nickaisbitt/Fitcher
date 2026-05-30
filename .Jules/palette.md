
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.
## 2026-05-30 - Actionable Empty States and Accessible Compact Forms
**Learning:** Text-only empty states cause friction by forcing users to figure out next steps independently. Additionally, compact UI elements (like API key inputs or icon buttons) often lack necessary context for screen readers.
**Action:** Always replace text-only empty states with actionable UI patterns that include an icon, clear context, and a primary CTA (e.g., fetching data or opening a position). For visually constrained inputs, use explicit `<label>` tags with Tailwind's `sr-only` class to maintain visual design while ensuring full screen reader accessibility. Ensure dynamic icon toggles use state-aware `aria-label` attributes.
