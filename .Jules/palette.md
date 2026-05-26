
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## 2024-11-20 - Ensure htmlFor Attributes for Inline React Form Elements
**Learning:** Found several input elements (like Stop Loss % and Take Profit %) missing their explicit label associations, which breaks screen reader support. Since the app uses Babel to compile an inline React app, standard JSX `htmlFor` and `id` properties must be strictly applied on label/input pairs.
**Action:** When adding or modifying configuration forms, always ensure `<label htmlFor="field-id">` is explicitly mapped to `<input id="field-id">`.
