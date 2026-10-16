---
__default__: patch
---

`ui-view-host`'s `matchContents` sizes it to the element it holds again with `@expo/ui` 57.0.23 and later, on iOS and Android, which a `ui-context-menu` trigger and a `ui-bottom-sheet` with `fitToContents` rely on.

From 57.0.23 the native view reads `matchContentsHorizontal` and `matchContentsVertical` in place of `matchContents`, so the host filled what SwiftUI or Compose offered it instead: a sheet with `fitToContents` opened taller than its content. `ui-view-host` now sends both forms, so it sizes to its element on either side of the change.
