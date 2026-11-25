---
title: Build for Linux
summary: The same Angular app as a native Linux app with GTK and libadwaita views, to a package.
---

# Build for Linux

An Angular Native app runs on Linux as a native app: GTK 4 and libadwaita views drawn by the
[desktop host](/packages/desktop), React Native's C++ core and Hermes, with no web view. It is the
same app, the same APIs and the same tests as the [Mac's](/guide/desktop). This page is what
Linux adds: setting up, testing from a Mac, and packaging.

## Start

The desktop template runs on both desktop OSes:

```sh
npx create-expo-app@latest my-app --template @ng-native/template-desktop
cd my-app
npm start          # the dev server, in one terminal
npm run linux      # on Linux: gets the GTK host the first time, then opens the app
```

`npm run linux` is `ng-native-desktop run --os linux`, and it runs on Linux only. On a Mac it stops
before it fetches or builds anything, and says to run it on a Linux machine or VM, or to make the
Linux packages with `npm run package -- --os linux`. From a Mac you test Linux through
[`vitest --project linux`](#test-linux-from-a-mac) and ship it with `package`.

To add Linux to an app you have, see [Desktop setup](/packages/desktop#setup), which covers `linux`
in `expo.platforms`, the `linux` script, Nx and the Angular CLI. `npx expo export -p linux` is
refused by Expo until `app.config.js` calls `registerLinux` from `@ng-native/metro/linux.cjs`:

```js
// app.config.js
require('@ng-native/metro/linux.cjs').registerLinux(__dirname);
module.exports = ({ config }) => config;
```

`npm start`, `npm run linux` and `npm run package` do not need it.

## What runs where

A Linux package runs on the desktop's own GTK and libadwaita, or, for a Flatpak, on the GNOME
runtime it brings. The host is built on AlmaLinux 9, so it needs glibc 2.34 at most.

| Library         | At least | Where it matters                                                        |
| --------------- | -------- | ----------------------------------------------------------------------- |
| glibc           | 2.34     | `deb` and `rpm`                                                         |
| GTK             | 4.10     | `deb` and `rpm`; accessibility announcements need 4.14                  |
| libadwaita      | 1.4      | `deb` and `rpm`; dialogs use 1.5, spinners 1.6 and toggle groups 1.7    |
| libsecret       | any      | `deb` and `rpm`: SecureStore                                            |
| glib-networking | any      | `deb` and `rpm`: the desktop's proxy settings                           |
| GStreamer       | 1.22     | `deb` and `rpm`                                                         |
| OpenSSL         | 3        | the host links the system's, so `deb` and `rpm` depend on it by library |

The host checks for each newer API as it starts and uses an older one where it is missing, so a
newer libadwaita changes how a dialog or a spinner is drawn and not whether the app runs.

The project's CI builds the host on AlmaLinux 9 for x64 and arm64 on every pull request, and
launches it each night on Ubuntu 24.04 and 26.04, Debian 13, and Fedora 44 and 45. A `deb` is made
for Debian 13 and Ubuntu 24.04 or later and an `rpm` for Fedora and the RHEL family 9 or later. A
Flatpak does not depend on the system's libraries.

## Build the host from source

`npm run linux` uses a [prebuilt host](#prebuilt-hosts) when there is one for the app. Otherwise it
builds the GTK host from source, which takes longer than a Mac's build and is reused after the
first one, in `$XDG_CACHE_HOME/ng-native/desktop` (`~/.cache` when that is not set). Before it
starts, the command checks the toolchain and stops with a fix-it line for each problem. It needs:

| Tool                 | Minimum              |
| -------------------- | -------------------- |
| clang and lld        | installed            |
| CMake                | 3.25                 |
| Ninja                | 1.10                 |
| GTK 4 headers        | 4.10                 |
| libadwaita headers   | 1.4                  |
| libsecret headers    | 0.20                 |
| Git, curl, unzip, xz | installed            |
| Perl with `shasum`   | installed            |
| Python 3, pkg-config | installed            |
| Pango, Fontconfig    | development packages |
| GLib, X11            | development packages |
| OpenSSL 3, nghttp2   | development packages |
| zlib, SQLite         | development packages |

On Debian and Ubuntu:

```sh
sudo apt install clang lld cmake ninja-build git curl unzip xz-utils perl python3 pkg-config \
  libgtk-4-dev libadwaita-1-dev libsecret-1-dev libpango1.0-dev libfontconfig-dev libglib2.0-dev \
  libx11-dev libssl-dev libnghttp2-dev zlib1g-dev libsqlite3-dev
```

On Fedora, and on RHEL 9 and its rebuilds:

```sh
sudo dnf install clang lld cmake ninja-build git curl unzip xz perl perl-Digest-SHA python3 \
  pkgconf-pkg-config gtk4-devel libadwaita-devel libsecret-devel pango-devel fontconfig-devel glib2-devel \
  libX11-devel openssl-devel libnghttp2-devel zlib-devel sqlite-devel
```

On RHEL and its rebuilds, Ninja and the GTK and libadwaita headers are in the CRB repository:
`sudo dnf config-manager --set-enabled crb` first. The command names the package for apt or dnf by
`/etc/os-release`, and both when it cannot read it.

## Test Linux from a Mac

Everything an app's tests do on Linux works from a Mac, at three depths.

- **In Node.** `render(X, { os: 'linux' })` renders a component as on Linux, with recording fakes
  of the windows, menus and tray, and the desktop template's `node-linux` project resolves `.linux`
  files. `npm test` runs it. See [Testing on another OS](/packages/testing/testing-other-os).
- **In the real host.** `npx vitest --project linux` runs `src/**/*.device.ts` inside the GTK host,
  on real GTK widgets. On a Mac the host runs in the AlmaLinux 9 container image `ngn-el9`, under
  Docker or Colima, which you build once:

  ```sh
  docker build -t ngn-el9 node_modules/@ng-native/desktop/native/docker
  EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start   # in one terminal
  npx vitest --project linux
  ```

  The host binary is the prebuilt one for the Mac's architecture. See
  [In-app tests](/packages/testing/in-app-tests#what-a-run-does-on-linux).

- **A package.** `npm run package -- --os linux` makes the app folder and the `deb` on a Mac with
  no tools. The `rpm` and the Flatpak run in containers, through Docker or Podman.

What the container cannot show is on a real desktop: Orca, Wayland, input methods, fractional
scaling and the KDE conventions.

## Package the app

```sh
npm run package -- --os linux                                  # dist/linux: the app folder and .tar.gz
npm run package -- --os linux --format deb --maintainer "Ada Lovelace <ada@example.com>"
npm run package -- --os linux --format rpm --license MIT
npm run package -- --os linux --format flatpak --license MIT
```

`--os` defaults to the machine's own, so on Linux `npm run package` makes the same. A Linux
package is a release build with the JavaScript compiled to Hermes bytecode, one package for each
architecture: `--arch x64` or `--arch arm64` makes one, and `--arch all`, the default, both.
`--output` puts them somewhere other than `dist/linux`.

| Format    | Makes                                                  | For                                          |
| --------- | ------------------------------------------------------ | -------------------------------------------- |
| `app`     | a runnable folder and its `.tar.gz`                    | testing, and a download for any distribution |
| `deb`     | `<name>_<version>_<amd64 or arm64>.deb`                | Debian 13 and Ubuntu 24.04 or later          |
| `rpm`     | `<name>-<version>-1.<x86_64 or aarch64>.rpm`           | Fedora and the RHEL family 9 or later        |
| `flatpak` | a `.flatpak` for each architecture, and an OSTree repo | the sandboxed route, on the GNOME runtime    |

A `deb` and an `rpm` use the system's GTK and libadwaita, and are updated by the distribution's
package manager from your own repository. A Flatpak runs in a sandbox on the GNOME runtime 50 and
is updated from its own remote. `deb` and `app` need nothing but Node. `rpm` runs `rpmbuild` and
`flatpak` runs `flatpak-builder`, on Linux when they are installed and otherwise in a container,
AlmaLinux 9 for the `rpm` and Fedora 44 for the Flatpak, through Docker or Podman; the command
stops first, naming what is missing. A Flatpak for an architecture other than the machine's needs
QEMU's binfmt handlers.

What the command needs from the app, and stops before building to say what is missing:

- **`expo.description`.** Its first sentence is the summary software centres list.
- **`ios.bundleIdentifier`**, which is the Linux application id, as it is the Mac's bundle
  identifier. `deb`, `rpm` and `flatpak` need it; an `app` build makes `dev.ngnative.<slug>` when
  there is none. A Flatpak's id has three to five parts, with a dash only in the last.
- **`expo.icon`**, a square PNG, which is scaled into the hicolor sizes up to its own. An app with
  no icon installs none.
- **`--license`**, an SPDX expression such as `MIT`, for an `rpm` and a Flatpak.
- **`--maintainer`**, `"Name <email>"`, for a `deb`.
- **`--homepage`**, an `https` URL, and **`--categories`**, a list of freedesktop categories with a
  main one, such as `Utility;Office`. Categories default to `Utility`.

Each format installs `<app-id>.desktop`, whose `MimeType` lists the plugin options'
`documentTypes[].mimeTypes` and the app's URL schemes, the icons, and `<app-id>.metainfo.xml`, built
from `name`, `description` and `version` and from `--license` and `--homepage`. A `deb`, an `rpm`
and a Flatpak also install a D-Bus service and mark the desktop entry `DBusActivatable=true`, so
opening a link or a file starts the app, or hands it to the one that is running (see
[Windows](/packages/device/app-windows)). The package name is the slug, and the version is
`version`.

The plugin options hold nothing for Linux packaging. `capabilities` still applies, and a Flatpak
makes each declared path a `--filesystem` permission, and cannot run the system's programs: the
command warns about `spawn` and `paths` as it packages.

### Signing

Signing keys come from the environment, never from `app.json` or an argument. Set `NGN_GPG_KEY` to
the key's id, with the key in the GPG agent or in `GNUPGHOME`:

- **`app`** gets a detached, armoured `<name>-<version>-<arch>.tar.gz.asc` beside the archive.
- **`rpm`** is signed with `rpmsign`.
- **`flatpak`** has its commits and its repository's summary signed, so the remote can verify them.
- **`deb`** carries no signature of its own, since apt checks the repository's: sign the repository.

The command stops first when `NGN_GPG_KEY` is set and `gpg` is not installed. Linux has no
notarisation, Developer ID, Sparkle or `--feed-url`, and those flags stop the command on Linux.

### Distribute

The command makes packages, not repositories. Serve a `deb` or an `rpm` from your own apt or dnf
repository, built with the distribution's own tools, and the package manager updates it. For
Flatpak, serve the `flatpak-repo` folder it writes over HTTPS as the app's own remote:

```sh
flatpak remote-add --if-not-exists my-app https://example.com/repo --gpg-import=key.gpg
flatpak install my-app dev.example.MyApp
```

The `.flatpak` bundle installs on its own with `flatpak install ./my-app-1.0.0-x86_64.flatpak`,
fetching the runtime from Flathub. A Flatpak made this way is the app's own remote: Flathub does not
take an app that ships a prebuilt host without an exception, and the manifest the command writes
beside the repository is what a submission would start from.

The JavaScript updates in place, from a server you host, as on macOS: see
[Over-the-air updates](/guide/ota-updates). A new version of the host itself is a
new package.

## Prebuilt hosts

Each release of `@ng-native/desktop` publishes a Linux host for x64 and for arm64, in two
flavours: the debug host `npm run linux` runs, with React Native's debugger, and the release host
`package` ships. Each is built on AlmaLinux 9 and packed with its `hermesc`, and is not signed. A
download is checked by the SHA-256 in `prebuilt.json` and deleted if it does not match.

The command uses one when the app links no native desktop code of its own, its host libraries
(`react-native-screens`, `react-native-safe-area-context`, `react-native-svg`,
`react-native-webview`, `react-native-worklets` and `react-native-reanimated`) are the versions the
host was built with, and the app denies none the host has. Otherwise it builds from source, for the
machine's architecture. A Mac therefore packages for Linux with no Linux machine unless the app has
native desktop code of its own, which needs a Linux machine of each architecture it packages for.
`NGN_DESKTOP_FROM_SOURCE=1` always builds from source. See
[Prebuilt hosts](/packages/desktop/packaging#prebuilt-hosts).

## What differs on Linux

[What differs](/guide/desktop-differences) lists what the app sees: the `OS` token, which files a
Linux build takes, and the windows and the app. The host's own pages say what each part of an app
becomes on GTK:

- [Windows, menus and the tray](/packages/desktop/windows-and-menus): the menu bar on KDE Plasma
  and the header bar's main menu elsewhere, the tray as a StatusNotifierItem, and the badge.
- [Focus and accessibility](/packages/desktop/accessibility): Orca, and the structural navigation
  it does not have.
- [Expo modules on the desktop](/packages/desktop/expo-modules): the portals each service uses.
- [Sizing for GNOME](/guide/desktop-sizing#sizing-for-gnome).
