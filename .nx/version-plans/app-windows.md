---
__default__: patch
---

`@ng-native/device` has `AppWindows`, `CURRENT_WINDOW`, `provideMainWindow` and `provideAppLifecycle`, for several windows from one app on a host with the `NgNativeWindows` module: component windows, route windows that render a named outlet of the one Router, `canClose` guards, and `willQuit` handlers run before quitting. On iOS and Android without the module `open` resolves to `null`. `mount` from `@ng-native/platform` renders the root component in the main window where the host has windows, and `native-stack-outlet` takes its name from its route window.
