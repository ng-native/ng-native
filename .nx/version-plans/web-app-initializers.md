---
__default__: patch
---

`mount()` from `@ng-native/web` runs the app's initializers (`provideAppInitializer` and `APP_INITIALIZER`) before the root component is created, as the native `mount()` does, rather than never running them.

An initializer that returns a promise is started without delaying the first render, and one that fails reaches the `ErrorHandler`. An island mounted with `injector` is unchanged: its host app runs its own initializers.
