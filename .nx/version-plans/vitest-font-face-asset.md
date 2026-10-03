---
__default__: patch
---

A component whose stylesheet declares `@font-face` now loads in a test, under Vitest and `node --test`: the `require` the compiler writes for the font file gets the `{ testUri }` stand-in an image's does, where the test file failed with `require is not a function` before any test ran.
