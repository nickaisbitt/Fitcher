
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.
## 2026-06-19 - Secure CORS and Route Validation
**Vulnerability:** Missing frontend URL validation in config allowed wildcard CORS, and missing route parameter validation on `marketData.js` exposed the app to potential injection.
**Learning:** Always validate environment configurations like FRONTEND_URL to prevent insecure states at startup, and apply robust input validation middleware to all express route parameters.
**Prevention:** Enforce strict checks on configuration variables before app initialization and consistently use `express-validator` for API route inputs.
