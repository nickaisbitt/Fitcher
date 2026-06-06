
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-06-06 - Missing Input Validation in Market Data Routes
**Vulnerability:** The market data API endpoints (e.g., `/api/market/price/:pair`, `/api/market/orderbook/:pair`, `/api/market/trades/:pair`, `/api/market/subscribe`) lacked rigorous input validation for parameters, query strings, and body payloads. Attackers could potentially inject unexpected data types or malformed strings.
**Learning:** Even internal or read-only API routes require strict validation of their inputs. Failing to sanitize route parameters (like `pair`) and query parameters (like `limit` or `depth`) exposes the system to edge cases, unexpected application behavior, or downstream injection attacks if the data is subsequently logged, cached, or passed to external services without validation.
**Prevention:** Always use `express-validator` to strictly type-check, format-check (e.g., regex for trading pairs), and validate all incoming data (`param`, `query`, `body`) before it reaches the controller logic. Include a consistent validation error-handler middleware to reject invalid requests cleanly.
