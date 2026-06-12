
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-12 - Secure CORS Configuration
**Vulnerability:** The application was vulnerable to overly permissive CORS configurations if `FRONTEND_URL` was set to a wildcard `*` in the environment variables. This could allow any origin to access the API.
**Learning:** Hardcoding or inadequately validating environment variables related to origin policies can easily lead to Cross-Origin Resource Sharing (CORS) misconfigurations.
**Prevention:** Explicitly validate `FRONTEND_URL` at application startup in `src/config/index.js` and fail-fast (terminate the app) if a wildcard origin is configured. This prevents the app from even starting with an insecure CORS configuration.
