
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-14 - Input Validation on Market Data Routes
**Vulnerability:** Missing input validation on market data endpoints (e.g., pairs, depth, limit) allowed arbitrary strings or unexpected types to reach the controller layer.
**Learning:** This exposes the application to potential injection attacks, excessive memory usage (e.g., depth limits), or unexpected crashes.
**Prevention:** Strictly validate and type-check all route parameters, query strings, and JSON body payloads using `express-validator` to defend against injection attacks. Use specific regex patterns like `/^[A-Z0-9]{2,10}[\/\-][A-Z0-9]{2,10}$/i` for trading pairs.
