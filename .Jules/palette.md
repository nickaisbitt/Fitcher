
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## $(date +%Y-%m-%d) - Explicit Form Label Association for Accessibility
**Learning:** In inline React applications compiled via Babel, standard HTML attributes for forms must follow JSX camelCase conventions (`htmlFor` instead of `for`) and explicit `id`s to ensure robust screen reader accessibility. Visually wrapping inputs in labels is not sufficient.
**Action:** Always verify form inputs have unique `id` attributes and their corresponding `<label>` tags use `htmlFor={id}`.

## $(date +%Y-%m-%d) - Dynamic ARIA Labels for Stateful Controls
**Learning:** Icon-only toggle buttons (like mute/unmute controls) without text labels fail accessibility audits. Using a static `aria-label` like "Sound settings" is insufficient because it does not communicate the current state or the result of the action to screen reader users.
**Action:** Use dynamic `aria-label` values that describe the *action* based on the current state (e.g., `aria-label={isEnabled ? 'Disable' : 'Enable'}`) to provide clear context for screen readers.
