## 2024-04-28 - Explicit Origin CORS Callback
**Vulnerability:** Overly permissive CORS configurations if configured poorly, and lack of dynamic origin verification. Express CORS with a simple string origin allows mobile clients and non-browser origins to spoof CORS easily. Socket.io was using string configuration.
**Learning:** Always use a function callback in Express `cors` and Socket.io `cors` to validate the `origin` header. `origin === '*'` should be explicitly disallowed in app config. Mobile apps and native clients may not send an `origin` header, so check `!origin`.
**Prevention:** Implement an `origin: (origin, callback)` check in CORS options to securely limit incoming connections, validating against specific domains, and ensuring configuration explicitly forbids wildcards.

## 2024-04-28 - Environment-Based Information Leakage
**Vulnerability:** The error handler was checking `process.env.NODE_ENV === 'production'` to hide stack traces. This meant stack traces could be leaked in `test` or `staging` environments.
**Learning:** It is more secure to allowlist environments where sensitive data (like stack traces) is shown rather than blocklisting `production`.
**Prevention:** Strictly use `NODE_ENV === 'development'` to show stack traces and sensitive error details, failing securely in all other environments.

## 2024-04-28 - NoSQL/Object Injection via Express Queries
**Vulnerability:** `req.query` objects in Express can be passed as complex objects (e.g., `?type[$ne]=something`) leading to NoSQL-style query injections when passed directly into Prisma where clauses.
**Learning:** Query parameters and route parameters cannot be trusted as simple strings.
**Prevention:** Always explicitly call `.toString()` or use type coercion (e.g. `String(req.query.param)`) before using parameters in database queries to ensure objects are cast safely.
