## 2026-04-29 - Hardcoded Secret Risk (JWT_REFRESH_SECRET fallback)
**Vulnerability:** JWT_REFRESH_SECRET fell back to JWT_SECRET if not provided. This meant compromised access token secrets automatically compromised refresh tokens as well.
**Learning:** Secrets must be isolated. Never allow fallback of critical separate secrets to a shared value.
**Prevention:** Explicitly separate configuration for distinct secrets. Add the specific secrets to `requiredVars` array in startup config to enforce their presence and "fail fast" safely rather than falling back to an insecure default.
