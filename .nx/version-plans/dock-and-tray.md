---
__default__: patch
---

`@ng-native/device` has a `Dock` service, with a menu and a bounce for the Dock icon on macOS, and a `Tray` service that `<tray-icon>` from `@ng-native/components` registers with, for icons in the macOS menu bar's status area. Both report themselves absent, and do nothing, on iOS and Android.
