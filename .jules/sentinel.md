
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-05-16 - Trust Proxy bypass for Express Rate Limiting
**Vulnerability:** The Express application uses `express-rate-limit` without setting `trust proxy`. When deployed behind a reverse proxy (like Nginx or an ALB), all requests appear to come from the proxy's IP address.
**Learning:** This misconfiguration renders IP-based rate limiting entirely ineffective, as rate limits are applied to the proxy rather than individual user IPs, potentially locking out all users simultaneously or failing to limit actual abusive users.
**Prevention:** Always explicitly configure `app.set('trust proxy', 1 /* or specific proxy config */)` when using rate limiters or IP-dependent middleware in an Express application deployed behind a reverse proxy.
