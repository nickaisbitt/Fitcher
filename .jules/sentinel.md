
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2026-05-17 - Secure CORS and Proxy Configuration
**Vulnerability:** CORS origin was configured directly to a configuration variable that could have been a wildcard (`*`). Additionally, `app.set('trust proxy', 1)` was hardcoded, introducing a risk of IP spoofing (and rate limit bypasses) for deployments not strictly behind a reverse proxy.
**Learning:** Hardcoding `trust proxy` can render rate-limiters useless if internet traffic directly hits the server. For CORS, if wildcard domains aren't strictly blocked at startup, dynamic origins could bypass intent.
**Prevention:** Always validate critical environmental configuration variables (like `FRONTEND_URL`) to prevent wildcards if strict origin validation is intended. Never blindly set `trust proxy` in application code unless driven by environment configurations indicating the app is behind a trusted load balancer/proxy. Use an origin function `(origin, callback)` for Express/Socket CORS to safely account for missing origins while strictly enforcing allowed domains.
