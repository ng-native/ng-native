---
'__default__': patch
---

A new app's `src/main.ts`, from the template, `@ng-native/nx:app` or `ng add @ng-native/schematics`, stops `watchConditions` as the app is destroyed, so an Android activity recreation (a font scale change, for one) no longer leaves the old app watching the device's conditions beside the new one. An existing app can do the same: keep what `watchConditions(app.engine)` returns, as `const stopWatching = watchConditions(app.engine);`, and pass it to `app.applicationRef.onDestroy(stopWatching)`.
