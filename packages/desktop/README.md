# @ng-native/desktop

The macOS desktop host for Angular Native: React Native's C++ core and Hermes, mounting an app's
views into AppKit, and the `ng-native-desktop` command that builds and launches it. You install the
package and never import it.

Alpha: APIs may change before 1.0.

## Install

Most Mac apps start from `npx create-expo-app@latest my-app --template @ng-native/template-desktop`.
To add macOS to an app you have:

```sh
npx expo install @ng-native/desktop
```

Then list `macos` in `expo.platforms`, set `expo.experiments.outOfTreePlatforms` to `true` and add
`@ng-native/desktop` to `expo.plugins`. [Setup](https://ng-native.com/packages/desktop#setup) has
the details, and the Nx and Angular CLI generators that do it for you.

## Commands

```sh
npm start                          # the Expo CLI's dev server, in one terminal
npx ng-native-desktop run          # builds the host the first time, then opens the app
npx ng-native-desktop package      # dist/macos/<name>.app; --format dmg or mas to ship it
```

The first run for a React Native version builds the host from source, which needs Xcode 16 or its
Command Line Tools, CMake and Ninja, unless the package has a prebuilt host for that version and
the app has no native desktop code of its own.

## Docs

- [Build for the Mac](https://ng-native.com/guide/desktop), the guide, and
  [what differs](https://ng-native.com/guide/desktop-differences) from iOS and Android
- [Desktop](https://ng-native.com/packages/desktop): setup, running, packaging, config and native
  code
- [Views and controls](https://ng-native.com/packages/desktop/views),
  [windows, menus and the Dock](https://ng-native.com/packages/desktop/windows-and-menus) and
  [focus and accessibility](https://ng-native.com/packages/desktop/accessibility)
- [Expo modules on macOS](https://ng-native.com/packages/desktop/expo-modules)
- [Debugging and launch settings](https://ng-native.com/packages/desktop/development)
- [Inside a package](https://ng-native.com/packages/desktop/packaging)
- [The desktop host](https://github.com/ng-native/ng-native/blob/main/docs/desktop-host.md): the
  source layout and publishing a prebuilt host, for contributors

## License

MIT
