## 2024-04-25 - Fix missing token revocation check and NoSQL injection

**Vulnerability:** Refresh token revocation was not checked, allowing revoked tokens to be used to refresh access. Additionally, there were NoSQL/Object injection risks due to lack of typecasting Express query parameters (`req.query`).
**Learning:** Auth logic generated refresh tokens with no persistent state or revocation validation, and Prisma models didn't account for query parameters being arrays or objects, increasing risk.
**Prevention:** Store revoked token hashes in the `RefreshToken` Prisma model and check the revocation status on token refresh requests. Cast all `req.query` variables to strings before using them in database queries to avoid object injection.
