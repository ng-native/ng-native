---
__default__: minor
---

Linux is an OS that the packages, the Metro preset and tests know of, ahead of the Linux desktop host.

`OS_NAMES`, the `OS` token, `TestOs` and `ModulePlatform` gain `'linux'`, so a `switch` or `Record` that covers every OS needs a `linux` entry. The `os-comparisons-on-linux` migration notes the `=== 'ios'`, `!== 'ios'`, `=== 'macos'`, `!== 'macos'` and `!== 'android'` comparisons it finds in an app, with their file and line, and rewrites nothing; see [Updating an app](https://ng-native.com/guide/updating). There is no Linux desktop host yet, so a Linux app does not run.

On Linux, `DESKTOP` is true and `APPLE` false, the `linux:` and `desktop:` Tailwind variants match `platform-linux`, and `<code>` and `font-mono` use `monospace`. The CSS compiler builds a sheet for `linux` alone, with the filters iOS does not draw refused as on macOS. `expoModule()` answers the desktop host's modules there and never calls an Expo loader, and a missing one says to run `npm run linux`. Vibration is absent, sharing uses the desktop host's module, windows restore from React Native's `Settings` as on macOS, `Alert.prompt` is available, and the Dock and tray menus read `mod` as Ctrl.

`@ng-native/metro` registers `linux` with Expo SDK 58, which does not know it, for an app whose `expo.platforms` lists it: a `linux` bundle resolves `.linux`, then `.ios`, then `.native` files, takes React Native's iOS code, answers `Platform.select` from `linux`, then `ios`, `native` and `default`, and installs formatjs's `Intl` polyfills with English data and every time zone, since the Linux host's Hermes has no `Intl`. `expo export -p linux` also needs `require('@ng-native/metro/linux.cjs').registerLinux(__dirname)` in `app.config.js`. In `@ng-native/eslint-plugin`, a desktop event is allowed in a project that lists `linux`, and its messages say "a desktop OS" rather than macOS.
