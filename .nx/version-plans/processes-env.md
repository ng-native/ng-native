---
__default__: patch
---

`Processes` from `@ng-native/device` holds the environment a desktop app was started with, in `env`, read from the desktop host's module. It is absent on iOS, Android and the web, where `available()` is `false` and `env` is empty.
