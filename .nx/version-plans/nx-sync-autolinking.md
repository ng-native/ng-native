---
__default__: patch
---

`nx sync:check` now says an app lacks a native module or its config plugin, rather than that a development build would not link the module, which holds only where the app imports a library through a path alias.

Expo's autolinking walks the app's dependency tree. Where the app imports a library through a tsconfig path alias, as in an integrated workspace, a native module the library imports is linked only when the app lists it or another of the app's dependencies brings it in. Where the library is a workspace package the app lists, a native module in the library's `dependencies` or required `peerDependencies` is linked too. Either way, the sync generator adds the module to the app, where `expo install --check` checks its version, and its config plugin to `app.json`, which is where Expo applies it from, apart from the few plugins Expo applies itself. The Nx page says the same.
