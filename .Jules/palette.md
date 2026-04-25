## 2024-05-18 - Auth Form Labels & Icon Button ARIA labels
**Learning:** Found multiple form inputs without associated labels (`htmlFor`) and icon buttons without `aria-label`s. Focus-visible styles are missing on interactive elements. The Auth form fields need IDs and their labels need `htmlFor` attributes to be screen reader accessible.
**Action:** Always verify that every `<input>` has a corresponding `<label htmlFor="...">` and every button lacking text content has an `aria-label`. Added focus-visible styles to improve keyboard navigation without messing up pointer interactions.

## 2024-05-30 - Added Confirmation to Destructive Actions
**Learning:** Destructive actions like closing a trading position were missing confirmation prompts, making accidental clicks costly and reducing user confidence.
**Action:** Always wrap destructive or irreversible button clicks (like `executeTrade('sell', ...)` for a manual close) in a confirmation dialog (e.g., `window.confirm` or a custom modal) to provide a safety net for users.
