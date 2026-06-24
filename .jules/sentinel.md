
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.
## $(date +%Y-%m-%d) - Wildcard CORS Vulnerability
**Vulnerability:** The application was vulnerable to severe Cross-Origin Resource Sharing (CORS) misconfigurations if `FRONTEND_URL` was set to the wildcard `*` or `null` origin. This allowed any external site to make authenticated cross-origin requests.
**Learning:** Hardcoding or loosely configuring CORS origins without startup validation can silently introduce critical access control vulnerabilities if deployment environments are misconfigured. Overcomplicating CORS functions is unnecessary when strict startup validation on the environment variable is sufficient.
**Prevention:** Implement strict startup validation in configuration files (like `src/config/index.js`) to explicitly reject wildcard or null origins for critical frontend URLs, and fail securely in production environments.
