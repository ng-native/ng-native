---
__default__: patch
---

A Vitest run with `ngNative()` from `@ng-native/testing/vitest` no longer leaves a directory in the system temp directory.

Vitest copies each module it runs there and, when the config has no `projects`, never removed it; the plugin now removes it as Vitest closes.
