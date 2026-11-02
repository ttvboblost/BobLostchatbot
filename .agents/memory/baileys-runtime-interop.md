---
name: Baileys runtime interop
description: Runtime import behavior at the Baileys and Node ESM boundary.
---

Validate the built Node runtime, not only TypeScript, when using Baileys generated protobuf exports and deep utility imports.

**Why:** Node's ESM loader did not resolve an extensionless deep import, and the generated protobuf namespace was not available as a named ESM export.

**How to apply:** Keep explicit `.js` extensions on deep Baileys imports and load its generated protobuf namespace through a CommonJS-compatible path; run the built service to verify.
