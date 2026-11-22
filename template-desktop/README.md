# My Angular Native desktop app

A native macOS and Linux app in Angular, created from `@ng-native/template-desktop`: real AppKit
views on a Mac and real GTK views on Linux, a sidebar and a menu bar, and no web view.

Expo is your build tool here, not your runtime. Its CLI, config, autolinking and Metro build the
app, and none of Expo ships in it: the `@ng-native/desktop` host runs it.

```sh
npm start          # Metro, the dev server the app loads from; leave it running
npm run macos      # on a Mac: builds the desktop host and opens the app, with Fast Refresh
npm run linux      # on Linux: the same, in GTK
npm test           # the example test in src/app/app.test.ts, in Node with no app window
npm run typecheck
npm run package    # dist/macos/my-app.app, or dist/linux/ on Linux
npm run package -- --format dmg   # a signed, notarised .dmg; --format mas for the Mac App Store
npm run package -- --os linux --format deb   # a .deb; --format app, rpm or flatpak too
```

To run tests inside the app, on real native views, run the `macos` or `linux` Vitest project,
which starts Metro and opens the app itself (`src/app/app.device.ts` is the example):

```sh
npx vitest --project macos   # on a Mac, in AppKit
npx vitest --project linux   # in GTK: on Linux, or on a Mac in the ngn-el9 container
```

The `linux` project runs the debug host `npm run linux` uses. On a Mac it runs the prebuilt Linux
host for the Mac's architecture in the `ngn-el9` image, which you build once with Docker or Colima:
`docker build -t ngn-el9 node_modules/@ng-native/desktop/native/docker`.

`npm test` runs the two Node projects, `node-macos` and `node-linux`, alone.

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
