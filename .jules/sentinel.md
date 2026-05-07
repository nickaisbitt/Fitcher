## 2024-05-07 - NoSQL/Object Injection via req.query

**Vulnerability:** `req.query` properties were being passed directly to Prisma's find functions without type casting, allowing an attacker to pass objects (e.g. `?status[in]=OPEN`) and potentially perform a NoSQL/Object Injection attack.
**Learning:** This existed because `req.query` parsing in Express allows nested objects, and Prisma accepts objects for complex filtering.
**Prevention:** Always explicitly typecast `req.query` properties to strings (or numbers/booleans as appropriate) before passing them to Prisma.
