---
__default__: patch
---

`ng-native-desktop run --url <link>` opens the app on a link, which it reads as `Linking`'s initial URL, as a click on a link to the app's scheme would, so a dev run can start on a route. A packaged app ignores it.
