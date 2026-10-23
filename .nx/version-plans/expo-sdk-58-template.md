---
__default__: patch
---

The starter template, and the apps `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` write, start on Expo SDK 58: `expo` `~58.0.16`, React Native 0.88.0, React 19.3.0, `expo-status-bar` `~58.0.3`, `expo-system-ui` `~58.0.6` and `react-native-safe-area-context` `~5.10.1`, as `npx expo install --check` expects. The packages still run on SDK 57, so an existing app moves when it chooses to, with `npx expo install expo@^58.0.0` and then `npx expo install --fix`.

- The app's `tsconfig.json` extends `expo/tsconfig.base.json`. SDK 58's `expo` has an exports map, and Vitest cannot find `expo/tsconfig.base` without its extension, so every test file failed to load with `Failed to load tsconfig 'expo/tsconfig.base'`. An app already on SDK 58 makes the same change to its own `tsconfig.json`.
- `src/main.ts` no longer types `registerRunnable`'s `rootTag` as `number | string`, which React Native 0.88's `RootTag` type is not, and which failed `npm run typecheck` on SDK 58. An app already on SDK 58 removes the annotation from its own `src/main.ts`: `({ rootTag }) =>`.
- A widget or Live Activity layout keeps an `@if` or `@switch` that matches no branch as an empty child in its place, as JSX keeps a `false`, rather than dropping it. expo-widgets 58 identifies each view by its position among its siblings, so the views after such a block now keep their identity when it changes, as they do in a JSX layout. Native skips the empty child on SDK 57 and 58, so nothing draws differently.
