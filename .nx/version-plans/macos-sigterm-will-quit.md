---
__default__: patch
---

On macOS, a SIGTERM to the desktop host now runs the app's `AppLifecycle.willQuit` handlers before the host ends, where it ended without running any app code. No `canClose` guard is asked, and the host ends once the handlers have finished or two seconds after the signal, including when the signal arrives while a Command-Q is still waiting on a guard and that guard then says no. `NativeWindowEvent`'s `quitRequest` in `@ng-native/device` has an optional `terminate` flag for it.
