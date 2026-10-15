---
'__default__': patch
---

`deepLinkSource()` is exported from `@ng-native/device`. It was written and used by `DeepLinks`, and its type `DeepLinkSource` was exported, but the function was not, so an app that needs the whole address of a link, which `DeepLinks.subscribe` strips to a path, had to listen to React Native's `Linking` itself.
