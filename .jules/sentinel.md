
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.
## 2024-05-18 - Predictable Randomness & Wildcard CORS
**Vulnerability:** The codebase used `Math.random().toString(36)` to generate IDs for alerts, audits, and events, which is cryptographically insecure and predictable. Additionally, `config.FRONTEND_URL` had no validation, potentially allowing wildcard `*` CORS origins with credentials enabled.
**Learning:** Hardcoded ID generation should rely on the `crypto` module for high entropy. For CORS, sensitive configurations must explicitly reject wildcards when `credentials: true` is used.
**Prevention:** Use `crypto.randomUUID()` or `crypto.randomBytes(n).toString('hex')` for ID generation. Add explicit startup validation to critical security configuration variables.
