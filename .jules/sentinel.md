## 2024-05-20 - Prevent Express req.query NoSQL Injection
**Vulnerability:** Controller functions taking unsanitized parameters from `req.query` and spreading them directly into Prisma queries allow NoSQL/Object injection.
**Learning:** `req.query` params are not guaranteed to be strings. An attacker could pass nested objects (e.g., `?type[contains]=`) which Express parses as an object, allowing query manipulation.
**Prevention:** Always explicitly cast `req.query` values to strings (e.g. `req.query.status?.toString()`) before passing them to ORM or database queries.

## 2024-05-20 - Prevent Wildcard CORS Misconfiguration
**Vulnerability:** A wildcard `*` assigned to `FRONTEND_URL` config allows any origin to interact with the API with credentials, bypassing CORS.
**Learning:** Using `FRONTEND_URL` raw string directly into the Express or Socket.io cors plugin can result in a wildcard origin bypassing protections when the env isn't properly configured.
**Prevention:** Validate that `FRONTEND_URL` is not `*` at the config level, and use a functional `origin` callback `(origin, callback)` to safely handle browser vs non-browser requests while explicitly enforcing the expected origin.
