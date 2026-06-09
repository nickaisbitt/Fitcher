
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-09 - Wildcard CORS Misconfiguration
**Vulnerability:** The application allowed the `FRONTEND_URL` environment variable to be set to a wildcard (`*`), which could result in overly permissive CORS policies, allowing any domain to interact with the API with credentials.
**Learning:** Misconfiguration of environment variables related to CORS can lead to severe security vulnerabilities, especially when `credentials: true` is enabled in the CORS middleware.
**Prevention:** Explicitly validate security-critical configuration values like `FRONTEND_URL` at startup to forbid insecure settings such as wildcards, and terminate the application if they are found.
