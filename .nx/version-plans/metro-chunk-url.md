---
__default__: patch
---

The Metro preset has Expo build a lazy route's chunk URL from the dev server on iOS and Android, as Expo does where there is no global `location`.

Expo's native chunk URL is built from `location.origin` where there is one, and `@ng-native/web-compat` gives the page an `exp://` address React Native cannot fetch from. An app that sets a global `location` of its own to say where its chunks are hosted has them asked of the dev server instead.
