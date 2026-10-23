---
__default__: patch
---

`NativeNavigation.present()` shows a page of a tab behind the one in front over it after the app calls `router.resetConfig()`, where it failed with "Cannot match any routes" for a page whose route had been presented that way before the reset.
