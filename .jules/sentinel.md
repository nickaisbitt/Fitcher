## 2024-05-01 - CSRF Protection

**Vulnerability:** CSRF token verification was missing in the application despite cookie-based JWT authentication being used for APIs.
**Learning:** Adding a CSRF check requires changes to the login/signup route where the token is set and the authentication middleware where the token is validated. We have implemented double-submit cookie approach where the token is sent both in an HttpOnly cookie and in a non-HttpOnly cookie that is then passed back as a header. Since we were generating a JWT that could be set via cookies or as a Bearer token, we need to enforce that if a user uses cookies (a browser user) for state-changing operations they must supply the CSRF header.
**Prevention:** Always enforce CSRF checking for any endpoint utilizing cookie-based authentication, and verify any new endpoints automatically inherit this check via the shared auth middleware.
## 2024-05-01 - Path Traversal Prevention

**Vulnerability:** In `ParquetWriter` and `AlertManager`, user-controlled or date-based filenames were being combined directly into paths using `path.join()`. While `Date.now()` or timestamps are not generally controllable, using variables to define path operations without validation can lead to path traversal vulnerabilities if those variables become user-controlled or maliciously formulated.
**Learning:** Preventing path traversal involves both sanitization and verification. The safest pattern to read or write local files is extracting the base filename using `path.basename()` to strip any directory sequences (like `../`), joining it securely to the intended directory using `path.join()`, and finally explicitly validating that the resulting absolute path resides entirely within the expected target directory using `filePath.startsWith(targetDir)`.
**Prevention:** Always follow the generate, extract, join, verify pattern: generate identifiers securely, extract basename, join path, verify directory containment.

**Refinement (Code Review feedback):** `startsWith` is susceptible to partial matches if a path separator isn't included (e.g. `startsWith('/data/1h')` is true for `/data/1h-backup/file.txt`).
**Action:** Enforce path containment matching using `dirPath + path.sep` instead of just `dirPath` to prevent partial prefix bypasses.
