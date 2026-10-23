---
'__default__': patch
---

A new app's `src/main.ts`, from the template, `@ng-native/nx:app` or `ng add @ng-native/schematics`, stops `watchConditions` as the app is destroyed, so an Android activity recreation (a font scale change, for one) no longer leaves the old app watching the device's conditions beside the new one. An existing app's entry point is changed the same way by the `stop-watching-conditions` migration, which `nx migrate`, `ng update` and `npx @ng-native/migrate` run: what `watchConditions(app.engine)` returns is kept as `const stopWatching = watchConditions(app.engine);` and passed to `app.applicationRef.onDestroy(stopWatching)`. A call it cannot rewrite is left with a note saying what to add.
