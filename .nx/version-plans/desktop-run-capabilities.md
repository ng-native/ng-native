---
__default__: patch
---

`ng-native-desktop run` gives the host the capabilities in the `@ng-native/desktop` plugin options, so `Processes.spawn`, its environment and its declared paths behave in development as they do in an `app` or `dmg` that `ng-native-desktop package` made. A `--format mas` package runs in the App Sandbox, where `Processes.spawn` and declared paths are absent, and `package` warns about each.
