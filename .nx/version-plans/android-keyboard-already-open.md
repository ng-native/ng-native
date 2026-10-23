---
__default__: patch
---

On Android with `provideNativeKeyboard()`, a keyboard that is already up and still when the `Keyboard` service starts listening is reported at once: `Keyboard.height`, `metrics` and `position` say where it is, where they said zero until it next moved. That happens when the first thing to use the service, such as a `<keyboard-avoiding-view>`, appears while a field that does not use it, such as the native header's search bar, has the keyboard open.
