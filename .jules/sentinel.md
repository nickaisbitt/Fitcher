## 2024-05-18 - [NoSQL Injection via Express req.query]
**Vulnerability:** Express `req.query` parses complex queries as objects, which when passed directly into Prisma queries, can result in NoSQL injection (e.g. `?status[in]=...`).
**Learning:** `req.query` should never be implicitly trusted as a primitive value.
**Prevention:** Always cast `req.query` values using `?.toString()` or strictly validate them before using them as Prisma filters.

## 2024-05-18 - [Data Leakage via Lenient Error Handler]
**Vulnerability:** Error handlers conditionally exposing stack traces for any environment *other* than production (`NODE_ENV !== "production"`) leak sensitive data in test or staging environments.
**Learning:** Security features should use an explicit allowlist approach.
**Prevention:** Always strictly check for development mode (`NODE_ENV === "development"`) before exposing error stack traces.
