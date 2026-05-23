
## 2024-05-02 - Type-casting Request Inputs
**Vulnerability:** User inputs (req.body, req.query) were passed directly to string methods like `.toUpperCase()` and `.toLowerCase()` in controllers (`tradingController`, `backtestController`, `marketDataController`) without type-casting.
**Learning:** This exposes the application to `TypeError` crashes and potential NoSQL/Object injection vulnerabilities if an attacker sends an array or an object instead of a string.
**Prevention:** Always explicitly type-cast user inputs to strings (e.g., `String(req.body.param)`) before passing them to string methods or database queries.

## 2024-05-23 - Express Query Parameter Type Enforcing
**Vulnerability:** Express `req.query` properties can be passed by attackers as arrays (`?exchange[]=foo`) or objects (`?exchange[$ne]=bar`) instead of strings. When passed blindly to string methods or database queries, this causes NoSQL injections or application crashes.
**Learning:** Destructuring with default parameters (`const { exchange } = req.query;`) does not prevent arrays or objects from passing through. Explicit validation or casting is required.
**Prevention:** Always cast `req.query` values to strings `String(req.query.X)` before use, or use a robust validation library like `express-validator` to enforce the expected types.

## 2024-05-23 - CORS Wildcard Origin Protection
**Vulnerability:** The application was vulnerable to accidentally deploying with `FRONTEND_URL=*` allowing cross-origin requests from any attacker domain to access sensitive, credentialed endpoints.
**Learning:** `FRONTEND_URL` environment variables should be strictly validated upon application start.
**Prevention:** Added a strict termination check if `config.FRONTEND_URL === '*'` inside the configuration logic.
