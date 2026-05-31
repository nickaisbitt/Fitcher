
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-10-25 - Explicit Label Associations Improve Accessibility
**Learning:** Input elements lacking explicit `id` and `htmlFor` associations on labels hurt screen reader accessibility, even if they visually appear linked.
**Action:** Always link `<label>` tags explicitly to `<input>` tags using the `htmlFor` attribute corresponding to the `id` of the input field.

## 2024-10-25 - Dynamic ARIA Labels for Toggle Buttons
**Learning:** Icon-only toggle buttons (like the sound button) fail accessibility standards if their `aria-label` doesn't change to describe the *action* the button will perform when clicked.
**Action:** Use dynamic `aria-label` values for stateful buttons (e.g., `aria-label={isEnabled ? "Disable feature" : "Enable feature"}`).

## 2024-10-25 - Empty States as Discovery Points
**Learning:** Standard "No data" text in panels like Trades, Positions, and AI Analysis results in a dead-end user experience.
**Action:** Redesign empty states across the application to include large relevant emojis, descriptive text, and clear calls-to-action to improve feature discovery and visual appeal.
