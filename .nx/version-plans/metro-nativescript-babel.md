---
__default__: patch
---

An app with `@nativescript/react-native` installed and no Babel config of its own gets the worklets plugin with `strictGlobal`, so a worklet naming a native class, such as `UILabel.new()`, no longer fails as the app starts with `Property 'UILabel' doesn't exist`.

An app with its own Babel config gets a warning saying what to add to it.
