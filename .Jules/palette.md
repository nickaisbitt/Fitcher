
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-11-20 - Adding Accessibility Labels to Inputs Without Explicit IDs
**Learning:** In React components compiled via Babel directly in the browser, form inputs that lack explicit `id` attributes cannot be reliably associated with their `htmlFor` labels by screen readers. Furthermore, inputs like API keys and risk management fields were lacking proper ARIA associations, making them invisible or confusing to assistive technology users.
**Action:** When creating form inputs, always ensure that an explicit `id` attribute is defined on the `<input>` and perfectly matches the `htmlFor` attribute on its corresponding `<label>`. For inline forms where a visible label isn't desired, add a `<label className="sr-only">` with the matching `htmlFor` and `id` for accessibility.
