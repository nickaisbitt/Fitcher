## 2026-04-30 - Prevent Path Traversal in File Operations
**Vulnerability:** Constructing filenames using purely timestamps (`Date.now()`) could be predictable. Lack of sanitization on filenames exposes systems to Path Traversal vectors if any input is mixed into the generated name without extracting purely the basename.
**Learning:** Always extract purely the basename using `path.basename()` from securely generated identifiers (e.g. UUIDs from `crypto.randomUUID()`) when saving dynamic files.
**Prevention:** Incorporate defense-in-depth by asserting the fully resolved path stringically starts with the absolute intented target directory (`filePath.startsWith(emailDir)`).
