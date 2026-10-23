---
__default__: patch
---

`Brightness`, `KeepAwake` and `ScreenCapture` each keep a window of their own when their Expo module is absent, so creating a second of them in Node tests or on the web host no longer throws.

Each window is kept by what it is for as well as by its native module, so the same object provided as the source of two services, such as one fake given to both `StatusBar.SOURCE` and `NavigationBar.SOURCE`, gives each service its own claims too. Every app on one present native module still shares that module's window. `sharedBySource` from `@ng-native/device`, the helper `@ng-native/expo` uses for this, takes what the value is for as its first argument.
