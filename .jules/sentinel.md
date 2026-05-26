
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-05-26 - Prevention of Wildcard CORS Setup
**Vulnerability:** A wildcard (`*`) origin configured for Cross-Origin Resource Sharing (CORS) introduces significant security risks by allowing any origin to perform authenticated cross-origin requests, especially for APIs intended to be restricted to a specific frontend.
**Learning:** Overly permissive CORS configurations, particularly `config.FRONTEND_URL === '*'`, can lead to authorization bypass and data leakage if not strictly validated on startup.
**Prevention:** Hard-fail and terminate the process at initialization (`process.exit(1)`) if `config.FRONTEND_URL` is set to the `'*'` wildcard, thereby enforcing strict, explicit origin declaration for CORS.
