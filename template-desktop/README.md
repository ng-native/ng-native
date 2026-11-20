# My Angular Native macOS app

A native macOS app in Angular, created from `@ng-native/template-desktop`: real AppKit views, a
sidebar and a menu bar, and no web view.

Expo is your build tool here, not your runtime. Its CLI, config, autolinking and Metro build the
app, and none of Expo ships in it: the `@ng-native/desktop` host runs it.

```sh
npm start          # Metro, the dev server the app loads from; leave it running
npm run macos      # builds the desktop host and opens the app, with Fast Refresh
npm test           # the example test in src/app/app.test.ts, in Node with no app window
npm run typecheck
npm run package    # dist/macos/my-app.app
npm run package -- --format dmg   # a signed, notarised .dmg; --format mas for the Mac App Store
```

To run tests inside the app, on real AppKit views, run the `macos` Vitest project, which starts
Metro and opens the app itself (`src/app/app.device.ts` is the example):

```sh
npx vitest --project macos
```

`npm test` runs the Node project, `node-macos`, alone.

`npm run macos` uses the prebuilt debug desktop host, with React Native's debugger, published for
the app's React Native version when the app links no native code of its own and its host libraries
are the versions the host was built with. Otherwise the first run builds the host from source,
which takes a few minutes and needs Xcode's command line tools, CMake and Ninja; later runs reuse
it. `npm run package` needs full Xcode for the app icon.

`src/app/app.ts` is the root component and `src/main.ts` mounts it. The app's settings are Expo's
keys in `app.json` (`name`, `icon`, `scheme`, `ios.bundleIdentifier` for the bundle identifier),
and what has no Expo key is the `@ng-native/desktop` plugin's options: see
https://ng-native.com/packages/desktop.

`AGENTS.md` tells a coding agent how this framework differs from the web Angular it knows
(Claude Code reads it through `CLAUDE.md`). Add your own conventions to it as the app grows.

Docs: https://ng-native.com
