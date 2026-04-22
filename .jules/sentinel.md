## 2024-05-15 - Information Disclosure via Error Handling
**Vulnerability:** Internal error messages and stack traces were potentially leaked to the client in non-production environments (e.g., test or staging) due to a negated environment check (`!== 'production'`).
**Learning:** Security checks should be positive, explicit, and strict. Relying on "not production" can inadvertently expose sensitive data in public-facing lower environments.
**Prevention:** Always use an explicit whitelist approach for enabling insecure/debug features (e.g., strictly `NODE_ENV === 'development'`).

## 2024-05-15 - NoSQL/Object Injection via Uncast Query Parameters
**Vulnerability:** Express `req.query` objects were passed directly to Prisma's `findMany` clauses in `backtestController.js` and `tradingController.js` without type-casting.
**Learning:** Attackers can send nested objects in query strings (e.g., `?type[gte]=` or `?status[not]=`) that Express automatically parses as objects. Passing these directly to Prisma/ORMs can lead to unintended logic execution or data exposure.
**Prevention:** Always explicitly type-cast or validate query parameters expected to be strings before using them in database queries (e.g., using `?.toString()`).
