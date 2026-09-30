---
__default__: patch
---

A `<native-tab>` that names both `sfSymbol` and `drawable` now shows its drawable on Android, where it had no icon because the SF Symbol was always taken first.

Android's tab bar reads only a drawable and iOS's only a symbol, so the shorthand the running platform reads now comes first. A tab that names only one of them is unchanged.
