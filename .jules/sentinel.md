
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-11 - Forbid Wildcard CORS
**Vulnerability:** A wildcard (`*`) in `FRONTEND_URL` would result in an overly permissive CORS configuration.
**Learning:** Hardcoded wildcard or unvalidated environment variables for CORS can lead to cross-origin data exposure.
**Prevention:** Explicitly validate `FRONTEND_URL` at application startup and crash if it is set to `*`.
