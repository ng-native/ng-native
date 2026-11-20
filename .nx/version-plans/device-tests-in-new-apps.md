---
__default__: patch
---

New apps from `@ng-native/template`, `nx g @ng-native/nx:application` and `ng generate @ng-native/schematics:application` come set up for tests inside the running app on iOS and Android: `npx vitest --project ios` or `--project android` runs `src/app/app.device.ts` on a simulator or emulator with nothing to add.

Their `metro.config.js` wraps the config in `withDeviceTests`, `src/main.ts` starts the test host when Metro is started for the tests, and `vitest.config.mts` has `node`, `ios` and `android` projects, with `npm test` and the generated `test` target running `node` alone. Their `.gitignore` ignores the `-actual.png` and `-diff.png` a failed screenshot comparison writes under `__screenshots__`. An existing app can add the same as https://ng-native.com/packages/testing/in-app-tests#set-up describes.

`nx g @ng-native/nx:tailwind` and `nx g @ng-native/nx:nativescript` add the Tailwind sheet and `provideNativeScript()` to the object an app's `mountOptions()` returns, which the template's `src/main.ts` now mounts with as the desktop template's already did, where before they asked for it to be added by hand.
