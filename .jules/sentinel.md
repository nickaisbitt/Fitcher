## 2026-05-07 - Add Double-Submit Cookie CSRF protection
**Vulnerability:** Missing CSRF protection on state-changing API routes (POST, PUT, DELETE, PATCH) when using cookie-based authentication.
**Learning:** The application used JWTs in httpOnly cookies but did not pair them with a readable token to prevent Cross-Site Request Forgery.
**Prevention:** Always pair httpOnly authentication cookies with an accessible CSRF token cookie (`httpOnly: false`) and require clients to submit this token in a custom header (e.g., `X-CSRF-Token`) for all state-changing requests. Ensure token count assertions in cookie unit tests are dynamically updated or sufficiently decoupled to accommodate such additions.
