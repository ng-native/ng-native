---
__default__: patch
---

`nx g @ng-native/nx:desktop <app>` and `ng generate @ng-native/schematics:desktop <app>` add macOS to an app: `@ng-native/desktop`, `macos` in `expo.platforms` with `experiments.outOfTreePlatforms: true`, the `@ng-native/desktop` config plugin, `/dist/macos` in the app's `.gitignore`, and `macos` and `package` targets that run `ng-native-desktop`. Each stops with an error on a project that has no `app.json`. The Angular CLI's `@ng-native/schematics:expo` builder takes `macos` and `package` as commands, and `macos` as an export platform.
