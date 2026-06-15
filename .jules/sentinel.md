
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.
## 2026-06-15 - Prevent Wildcard CORS Origins
**Vulnerability:** The application used FRONTEND_URL for CORS origins, but did not prevent it from being set to the wildcard *, which would allow any origin to access authenticated endpoints.
**Learning:** Permissive wildcard CORS configurations expose the application to cross-origin attacks, especially when credentials (credentials: true) are enabled.
**Prevention:** Always validate CORS origin configurations at startup to explicitly forbid the wildcard * origin.
