---
__default__: patch
---

New phone apps from `@ng-native/template`, `nx g @ng-native/nx:application` and `ng generate @ng-native/schematics:application` (without `--desktopOnly`) come set up for tests inside the running app on iOS and Android: `npx vitest --project ios` or `--project android` runs `src/app/app.device.ts` on a simulator or emulator with nothing to add.

Their `metro.config.js` wraps the config in `withDeviceTests`, `src/main.ts` starts the test host when Metro is started for the tests, following rotation, the theme and reduced motion as the app does, and `vitest.config.mts` has `node`, `ios` and `android` projects (a desktop-only app keeps its `macos` ones), with `npm test` and the generated `test` target running `node` alone. Their `.gitignore` ignores the `-actual.png` and `-diff.png` a failed screenshot comparison writes under `__screenshots__`. `startDeviceTests({ mount })` also takes a function that returns the mount options, which it calls each time it mounts, so the sizes and theme the options read are the device's at that mount, as after Android recreates the activity. An existing app can add the same as https://ng-native.com/packages/testing/in-app-tests#set-up describes.

`nx g @ng-native/nx:tailwind` and `nx g @ng-native/nx:nativescript` add the Tailwind sheet and `provideNativeScript()` to the object an app's `mountOptions()` returns, which the template's `src/main.ts` now mounts with as the desktop template's already did, where before they asked for it to be added by hand. `nx g @ng-native/nx:nativescript` also skips comments, strings and regular expressions in those options, and adds to the `providers` list the object itself has, not one in a comment or a nested object.
