---
'__default__': patch
---

The `Keyboard` service in `@ng-native/device` reports a keyboard that is already up when it starts, on iOS and Android, so `height`, `visible` and `metrics` no longer read as a hidden keyboard until it next moves. It starts from the last show or hide React Native's own `Keyboard` module recorded, and `watchConditions` now loads that module at startup so it records from then on. A keyboard the native header's search bar opened before the first `<text-input>` appeared is the usual case. An app that does not call `watchConditions` gets the start only for a keyboard opened after something first used the `Keyboard` service.
