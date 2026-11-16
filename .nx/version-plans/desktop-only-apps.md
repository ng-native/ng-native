---
__default__: patch
---

`nx g @ng-native/nx:app --desktopOnly`, `ng add @ng-native/schematics --desktop-only` and `ng generate @ng-native/schematics:application --desktop-only` make a macOS-only app from the desktop template: `macos` alone in `expo.platforms`, its sidebar and menu bar starter screen, its in-app test in `src/app/app.device.ts` with the Metro config that runs it, `macos` and `package` targets, and a `test` target that runs the Node Vitest project, `node-macos`, alone. `nx g @ng-native/nx:init --desktopOnly` makes it the default of the `application` generator in `nx.json`. The Angular CLI's `@ng-native/schematics:vitest` builder takes a `project` option, which runs one Vitest project.
