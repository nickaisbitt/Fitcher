
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-02 - Validate FRONTEND_URL to prevent CORS wildcard
**Vulnerability:** A wildcard (`*`) origin could be used for `FRONTEND_URL`, which is directly passed to CORS configurations in `app.js`.
**Learning:** This exposes the application to severe CORS vulnerabilities where any domain could make cross-origin requests and read sensitive data.
**Prevention:** Explicitly validate `FRONTEND_URL` in the centralized configuration (`src/config/index.js`) to reject wildcards and fail securely during application startup.
