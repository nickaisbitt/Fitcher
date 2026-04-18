## 2026-04-18 - [Algorithm Confusion in JWT]
**Vulnerability:** JWT verification calls did not specify allowed algorithms, opening the possibility for Algorithm Confusion attacks (e.g. passing an asymmetric key as symmetric).
**Learning:** `jwt.verify` without `algorithms` option defaults to allowing any algorithm the token says it uses.
**Prevention:** Always include `{ algorithms: ['HS256'] }` (or appropriate algorithm array) in `jwt.verify()` options.

## 2026-04-18 - [Insecure Randomness for IDs]
**Vulnerability:** IDs for EventBus events and Audit Logs were generated using `Math.random().toString(36).substr(2, 9)`.
**Learning:** `Math.random()` is not cryptographically secure and is predictable in JavaScript environments (e.g. V8). Predicting these values could lead to ID collisions, forgery, or side-channel information leaks.
**Prevention:** Always use cryptographically secure methods like `crypto.randomBytes(4).toString('hex')` or `crypto.randomUUID()` when generating IDs used in audit trails or cross-component messaging.