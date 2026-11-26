---
title: Desktop
summary: The macOS and Linux hosts and the command that builds, runs and packages the app.
---

# Desktop

`@ng-native/desktop` is the desktop host, for macOS and for Linux: React Native's C++ core and
Hermes, mounting an app's views into AppKit on a Mac and into GTK 4 and libadwaita on Linux, and the
`ng-native-desktop` command that builds the host and runs the app in it. You install the package and
never import it. [Build for Linux](/guide/desktop-linux) is the guide for the Linux half.

How the host draws an app, and what it does with each part of it, is on the pages under this one:
[Views and controls](/packages/desktop/views),
[Windows, menus and the Dock](/packages/desktop/windows-and-menus),
[Focus and accessibility](/packages/desktop/accessibility),
[Expo modules on the desktop](/packages/desktop/expo-modules),
[Portals on Linux](/packages/desktop/portals),
[Debugging and launch settings](/packages/desktop/development) and
[Inside a package](/packages/desktop/packaging).

## Setup

An app made from the desktop template has it already. To add macOS to an app:

```sh
npx expo install @ng-native/desktop
```

Then, in `app.json`, add `macos` (and `linux`, for Linux) to `expo.platforms`, set
`expo.experiments.outOfTreePlatforms` to
`true` (without it Expo drops `macos` from every bundle and export, and says nothing), add
`@ng-native/desktop` to `expo.plugins`, and add these scripts to `package.json`:

```json
{
  "scripts": {
    "macos": "ng-native-desktop run",
    "linux": "ng-native-desktop run --os linux",
    "package": "ng-native-desktop package"
  }
}
```

In an Nx workspace, `nx g @ng-native/nx:desktop <app>` does all of this, for macOS and Linux, and in
an Angular CLI workspace `ng generate @ng-native/schematics:desktop <app>` does. See
[Nx](/packages/nx#macos-and-linux) and [Angular CLI](/packages/schematics#macos-and-linux).

## Run the app

```sh
npm start        # the Expo CLI's dev server, in one terminal
npm run macos    # gets the host the first time, then opens the app from the dev server
```

The first `npm run macos` downloads a prebuilt debug host, with React Native's debugger, when
`@ng-native/desktop` has one for the app's React Native version and the app links no native desktop
code of its own (see [Prebuilt hosts](/packages/desktop/packaging#prebuilt-hosts)). Otherwise it
builds the host from source, which takes about 4 minutes on an Apple silicon Mac and about 6 for a
universal release build. Later runs reuse it. The host runs on macOS 14 and later.

The Expo CLI has no `run:macos`: its `run` commands are a fixed list, so `npm run macos` is
`ng-native-desktop run`. It takes a bundle path or URL in place of the dev server, and these
options:

| Option            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `--os <os>`       | `macos` or `linux`. Default: this machine's OS.           |
| `--module <name>` | The registered app to start. Default `main`.              |
| `--port <port>`   | The dev server's port. Default `8081`.                    |
| `--url <link>`    | A link to open the app on, as `Linking`'s initial URL.    |
| `--universal`     | Build for arm64 and x86_64. Default: this Mac's own arch. |

With no bundle, the host loads
`http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=macos&dev=true` straight from the
dev server and stays connected to it: an edit Fast Refreshes and keeps state, the dev server's
reload reloads, and so does Developer > Reload (Command-R). A bundle path or another URL can be
given instead. A bundle's images and other assets are read beside it as React Native lays them out
for an embedded bundle, so make it with `npx expo export:embed --platform macos --dev false
--bundle-output <dir>/main.jsbundle --assets-dest <dir>`; `npx expo export` puts them elsewhere.

A dev run shows as the app, as a packaged one does: the menu bar, About, Hide and Quit, the Dock and
the app switcher name the app, and the Dock and the app switcher show its icon (`ios.icon`, else
`icon`); an Icon Composer `.icon` folder shows only once the app is packaged. A dev run asks for a
permission in the app's name, so it needs the usage string a packaged app needs, can show
notifications once the user grants authorization, and shares its preferences with a packaged build
of the same bundle identifier.

Adding or removing one of the [libraries the host compiles
in](/packages/desktop/views#libraries-compiled-in) builds a source-built host again.

Building from source needs these tools; the command checks them first and stops with a fix-it line
for each problem:

| Tool                            | Minimum                | Fix-it when missing or older                 |
| ------------------------------- | ---------------------- | -------------------------------------------- |
| Xcode or the Command Line Tools | installed and selected | `xcode-select --install`                     |
| `swiftc`                        | Swift 6.0 (Xcode 16)   | Software Update, or `xcode-select --install` |
| CMake                           | 3.25                   | `brew install cmake` / `brew upgrade cmake`  |
| Ninja                           | 1.10                   | `brew install ninja` / `brew upgrade ninja`  |

A prebuilt host needs none of them.

### On Linux

`npm run linux` (`ng-native-desktop run --os linux`) runs the app in the GTK host on Linux, with the
same options as on a Mac but `--universal`, and the same prebuilt-or-build-from-source first run. On
a Mac it stops before it fetches or builds anything. [Build for
Linux](/guide/desktop-linux#build-the-host-from-source) lists the tools a source build needs.

The app's windows take its name. Where the app sets `icon` (`ios.icon` alone gives none), the
host offers it to GTK as the windows' default icon. GNOME on Wayland takes a window's name and icon
from the installed desktop entry, so a dev run there shows the app id and a generic icon unless an
installed package of the same app id supplies one.

## Package the app

```sh
npm run package                                   # dist/macos/<name>.app, ad-hoc signed
npm run package -- --format dmg                   # signed, notarised and stapled .dmg
npm run package -- --format dmg --feed-url https://example.com/appcast.xml --sparkle-key <key>
npm run package -- --format mas                   # a sandboxed Mac App Store .pkg
```

A package is a release build, universal for Apple silicon and Intel Macs, for macOS 14 and later.
Packaging needs full Xcode, which compiles the app icon (an image, or an Icon Composer `.icon`);
the Command Line Tools cannot, and the command says so before it builds anything. `--output`
puts the packages somewhere other than `dist/macos`, and `--arch x64` or `--arch arm64` cuts the
universal build to one architecture. `--os` defaults to the machine's own, so on Linux `npm run
package` makes a Linux package and `--os macos` a Mac one.

- **`app`** is signed ad hoc, for this Mac and for testing. With no `ios.bundleIdentifier` it gets
  one made from the slug.
- **`dmg`** is signed with your Developer ID and the hardened runtime, notarised, and stapled, app
  and disk image both. `--feed-url` embeds Sparkle with that appcast and makes the `.zip` Sparkle
  updates from beside the `.dmg`; only a `dmg` has Sparkle. It needs Sparkle's public EdDSA key,
  which Sparkle checks each update against: `--sparkle-key`, or `NGN_SPARKLE_PUBLIC_KEY`, set to
  what Sparkle's `generate_keys` prints. Sparkle then checks for updates on its own schedule,
  without first asking the user.
- **`mas`** is signed inside the App Sandbox with your provisioning profile, as an installer
  package for App Store Connect. The command names any capability the sandbox forbids, such as
  `spawn` and `paths`, which a sandboxed app cannot use.

A `dmg` or `mas` needs `ios.bundleIdentifier`. Credentials come from the environment, never from
`app.json`:

| Variable                                                              | For                                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `NGN_SIGN_IDENTITY`                                                   | The signing identity, for `dmg` and `mas`                              |
| `NGN_NOTARY_PROFILE`                                                  | A `notarytool` keychain profile (`xcrun notarytool store-credentials`) |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`               | Or an App Store Connect API key, for CI                                |
| `NGN_INSTALLER_IDENTITY`, `NGN_PROVISIONING_PROFILE`, `APPLE_TEAM_ID` | `mas`: the installer identity, the profile's path and the team         |
| `NGN_SPARKLE_PUBLIC_KEY`                                              | `dmg` with `--feed-url`: Sparkle's public EdDSA key                    |

A rejected notarisation stops the command with the submission's id, for
`xcrun notarytool log <id>`.

Sign in with Apple is an entitlement, as on iOS. A `mas` build of an app that uses
`expo-apple-authentication` (installed, its plugin listed, or `ios.usesAppleSignIn` set) is signed
with it, so its profile needs the Sign in with Apple capability. A `dmg` is signed with it only
when `ios.usesAppleSignIn` is `true`, and then needs `NGN_SIGN_IDENTITY`, a Developer ID
provisioning profile with the capability in `NGN_PROVISIONING_PROFILE`, and its team in
`APPLE_TEAM_ID`, with `--skip-notarize` too. The command embeds the profile, and adds the app's
identity on the team to its entitlements.

[Inside a package](/packages/desktop/packaging) has the steps the command runs, the `Info.plist`
keys it writes, updates, and the prebuilt hosts it can package in place of a build from source.

### On Linux

`npm run package -- --os linux` makes Linux packages (`app`, `deb`, `rpm` or `flatpak`), from a Mac
too. [Build for Linux](/guide/desktop-linux#package-the-app) has the formats, their options, what
each needs from `app.json`, signing and distribution; [Linux
packages](/packages/desktop/packaging#linux-packages) has what each package holds.

## Config

The macOS build reads what Expo already has a key for from that key, the one the iOS build reads:

| Setting            | Expo key                                                         |
| ------------------ | ---------------------------------------------------------------- |
| Bundle identifier  | `ios.bundleIdentifier`                                           |
| URL schemes        | `scheme` and `ios.scheme`                                        |
| Icon               | `ios.icon` (an Icon Composer `.icon` or an image), else `icon`   |
| Version and build  | `version` and `ios.buildNumber`                                  |
| Updates server     | `updates.url`                                                    |
| Usage strings      | `ios.infoPlist`, and each `expo-*` plugin's permission option    |
| Sign in with Apple | `ios.usesAppleSignIn`, and `expo-apple-authentication` installed |

On Linux the same keys give the package its identity: `ios.bundleIdentifier` is the application id
that names the desktop entry, the icon and the metainfo (an `app` build makes one from the slug when
there is none), `scheme` and `ios.scheme` are the URL schemes the desktop entry handles, `name`,
`description` and `version` are the package's, `slug` is its name and command, and `icon`, a square
PNG, is the app's icon. `ios.icon` is the Mac's. A Flatpak asks for the sound server only when the
app has a microphone usage string (`NSMicrophoneUsageDescription`), from `ios.infoPlist` or a
plugin's permission option.

The plugin options hold only what has no Expo key:

```json
[
  "@ng-native/desktop",
  {
    "documentTypes": [{ "name": "Markdown", "extensions": ["md"] }],
    "capabilities": {
      "spawn": [{ "program": "git", "args": ["status", "--porcelain"] }],
      "env": ["HOME"],
      "paths": [{ "path": "~/Projects", "access": "readwrite" }]
    },
    "deny": ["react-native-some-library"]
  }
]
```

- **`documentTypes`** - the files the app opens from Finder, by extension, and on Linux by the MIME
  types in `mimeTypes`, which its desktop entry lists.
- **`capabilities`** - the programs [`Processes.spawn`](/packages/device/processes) may run, the
  environment variables it may read, and paths outside the app's own folders.
- **`deny`** - npm packages whose native code stays out of the desktop build.

Expo runs the plugin whenever it reads the config, so an option that is not valid stops
`expo start`, `expo export` and `ng-native-desktop` with every problem listed. The plugin changes
nothing in the config.

## Native code

The desktop build finds native code the way Expo's autolinking finds a library's iOS and Android
code, walking the app's dependencies and theirs:

- **A library** opts in through its `expo-module.config.json`: `macos` among its `platforms`, and a
  `macos` entry naming the CMake target its desktop code builds and the folder holding its CMake
  fragment, `desktop` unless it says otherwise.

  ```json
  {
    "platforms": ["apple", "android", "macos"],
    "macos": { "cmakeTarget": "haptics_desktop", "cmakeDir": "desktop" }
  }
  ```

- **The app's own modules** are each `modules/<name>/macos/`, beside `ios/` and `android/`. The
  module's `expo-module.config.json` can name its CMake target the same way.
- **`deny`** in the plugin options keeps a package out, whatever it ships.

Linux is the same with `linux` for `macos`: a library lists `linux` among its `platforms` with a
`linux` entry beside `macos`, and the app's modules are `modules/<name>/linux/`. A library that
builds for both lists both, with one `cmakeDir` for both or one each, and each OS reads only its own
entry. A dependency with desktop code for one OS only is listed on the other.

`npm run macos` and `npm run package` list the dependencies that have native code for iOS or
Android and none for the desktop: their native modules are absent on macOS, so a service built on
one reports itself unavailable. `expo`, the `expo-*` packages and `@ng-native/*` are not listed,
since the desktop host answers their services itself. `react-native-screens`,
`react-native-safe-area-context`, `react-native-svg`, `react-native-webview`,
`react-native-worklets` and `react-native-reanimated` are compiled into the host when the app has
them.

`run` and `package` write what they found to `.expo/ng-native-desktop/link.json` in the app, which
the host build reads from `NGN_DESKTOP_LINK`. The file names its OS, and a build refuses one made
for another OS than its own. `deny` keeps a package out; the packages it depends on
are still found.

A library with a `codegenConfig` gets its specs' codegen, as on Android: the `<Name>JSI.h` its C++
TurboModule implements, and for its Fabric components their props, events and shadow nodes, which
the host compiles in and registers, so the component lays out and its events reach JavaScript. The
library draws it with a subclass of `NGNView` from the host's `component-view.h`, registered for
the component's name as it loads:

```objc
#import "component-view.h"
#include <react/renderer/components/MyLibSpec/Props.h>

@interface MyBadgeView : NGNView
@end

@implementation MyBadgeView
+ (void)load {
  NGNRegisterComponentView(@"MyBadge", self);
}
- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props]; // background, border, opacity and accessibility
  auto badge = std::dynamic_pointer_cast<const facebook::react::MyBadgeProps>(props);
  // ...
}
@end
```

Events go out through the codegen's `EventEmitter`, cast from `self.eventEmitter`. A component
with no view registered mounts as a plain view, and the host's own components keep theirs.
