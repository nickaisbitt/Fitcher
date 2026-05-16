
## 2024-10-25 - Actionable Empty States Drive Feature Discovery
**Learning:** Empty states in data-heavy components (like the Trades tab) can feel like dead ends if they only contain text like "No data".
**Action:** Replace text-only empty states with visually appealing, actionable components (icon, clear description, and CTA button) that guide the user to populate the data or discover related features, such as running a backtest to simulate trades.

## $(date +%Y-%m-%d) - Empty States & ARIA Labels in Dashboards
**Learning:** React applications compiled directly in the browser via inline Babel (like `public/index.html` here) require special care during Playwright testing since they may not render correctly if there are unhandled syntax errors. Additionally, standard text empty states ("No open position") are missed opportunities for CTA conversion.
**Action:** Always verify UI changes locally by testing them through simulated application entry points (e.g. bypassing demo logins). In dashboard interfaces, prioritize replacing generic empty text with actionable states containing relevant icons and "Start Bot" action buttons, while reinforcing small accessibility omissions like missing `aria-label` attributes on icon toggles and inputs.
