---
__default__: patch
---

The generated `.angular-native/app.tailwind.d.ts` now imports `StyleSheet` with `import type` instead of an `import()` type, which typescript-eslint's `consistent-type-imports` rule reported as an error when an app's lint reached the file.
