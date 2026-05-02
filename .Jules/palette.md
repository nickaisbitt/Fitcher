## 2024-05-01 - Icon Button Accessibility
**Learning:** React components containing icon-only buttons lacked aria-labels, which causes screen readers to read only "button" leading to poor accessibility.
**Action:** Always add descriptive `aria-label` or `title` tags to buttons whose content is visual only.
## 2024-05-01 - Loading States and Progress Indicators
**Learning:** During authentication operations like `login` and `signup`, the buttons were simply changing text to "Please wait..." and using `disabled:opacity-50`, but adding visual feedback such as a spinner provides stronger affordance that the app is working, leading to a much better user experience.
**Action:** Enhance loading states on primary action buttons by incorporating a spinner instead of just text changes, especially for async operations.
## 2024-05-01 - Keyboard Accessibility Enhancements
**Learning:** Found several clickable elements (like buttons and inputs) that lacked proper focus styling, making keyboard navigation difficult for users with screen readers or those who rely on keyboard navigation.
**Action:** Always ensure interactive elements like buttons, inputs, and custom components have a visible focus state, preferably using utility classes like `focus-visible:ring-2 focus-visible:ring-cyan-500 focus:outline-none`.
## 2024-05-01 - Missing Destructive Action Confirmation
**Learning:** Found that closing a position via `executeTrade("sell")` executes immediately. For destructive or critical actions like closing a trade manually, providing a confirmation prevents accidental clicks that could result in financial loss.
**Action:** Always wrap critical actions in a confirmation prompt.
