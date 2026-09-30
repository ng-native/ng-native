---
__default__: patch
---

In development, a `<native-tab>` now warns once, naming its path, when it has no icon on the running platform because it names only the other platform's shorthand: `sfSymbol` without `drawable` on Android, or `drawable` without `sfSymbol` on iOS.

A tab that binds `[icon]` or `[systemItem]`, or that names both shorthands, stays quiet, and a release build never warns.
