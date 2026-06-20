
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.
## 2023-10-27 - SSRF Vulnerability in Webhooks
**Vulnerability:** The application allowed user-defined URLs in webhook configurations (e.g., in `tradingEngine.js` and `alertManager.js`) to be passed directly to `fetch()` without validation.
**Learning:** This lack of validation allows attackers to perform Server-Side Request Forgery (SSRF), potentially accessing internal services, metadata endpoints (e.g., AWS `169.254.169.254`), or local loopback addresses (`localhost`, `127.0.0.1`).
**Prevention:** Always validate and sanitize user-provided URLs before making outbound requests. Ensure the URL scheme is strictly HTTP/HTTPS and block requests to internal IP ranges and localhost. A dedicated utility function like `isSafeWebhookUrl` should be used to enforce these checks centrally.
