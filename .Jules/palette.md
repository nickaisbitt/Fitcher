
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.
## 2026-07-02 - Linking Form Labels and Using Dynamic ARIA Labels
**Learning:** In inline React applications without Babel preprocessing for specific components, standard HTML properties like `id` and `htmlFor` are necessary to link inputs with labels to provide screen reader accessibility, and dynamic `aria-label` properties on toggle buttons properly convey actions to assistive tools. Empty states need actionable UI, not just plain text.
**Action:** Always verify `id` and `htmlFor` attributes on all `<input>` elements and `<label>` pairs, add dynamic ARIA labels to toggle buttons that lack text, and ensure empty states offer a distinct call-to-action to improve feature discoverability.
