---
__default__: patch
---

`pod install` no longer fails with "Unable to find a specification for `ExpoUI`" for an app that does not depend on `@expo/ui` in a workspace where another package or the root has it: `@ng-native/expo` builds its `@expo/ui` modifiers only where the app's own `package.json` lists `@expo/ui`.
