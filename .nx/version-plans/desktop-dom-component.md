---
__default__: patch
---

On macOS `<dom-component>` renders its DOM component in the desktop host's WebKit web view, with its inputs and outputs bound as on iOS, from the dev server in development and from the `www.bundle` that `ng-native-desktop package` writes into the app's `Resources` in a packaged app.
