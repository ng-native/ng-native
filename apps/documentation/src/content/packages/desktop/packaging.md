---
title: Inside a package
summary: What ng-native-desktop package runs on a Mac and on Linux, what it writes, prebuilt hosts.
---

# Inside a package

What `ng-native-desktop package` builds, the keys it writes, and where the host it packages comes
from. The macOS package comes first and [Linux packages](#linux-packages) after it.

## The build

`ng-native-desktop package [--format app|dmg|mas] [--arch x64|arm64|all] [--output <dir>]
[--feed-url <url>] [--sparkle-key <key>] [--skip-notarize]` builds a
universal Release host (arm64 and x86_64, without the core tests, dead code stripped), or takes the
[prebuilt one](#prebuilt-hosts), bundles
with `expo export:embed --platform macos` (the assets laid out as React Native's resolver reads
them beside an embedded bundle), compiles the bundle to Hermes bytecode with the `hermesc` the
host build puts beside its binary, for the same Hermes, and assembles
`<output>/<name>.app`: the host binary as `Contents/MacOS/<name>` with its local symbols stripped,
the `hermesvm.framework` it links in `Frameworks`, the bytecode bundle and assets in `Resources`,
the icon compiled by `actool`, and an `Info.plist` from the Expo keys. `hermesvm.framework` is
signed before the app, with the same identity. Then `app` is
signed ad hoc, `dmg` is signed with the hardened runtime, notarised and stapled (app and disk
image), and `mas` is signed in the App Sandbox and wrapped by `productbuild`. `codesign`,
`notarytool`, `stapler`, `hdiutil`, `ditto`, `sips`, `actool` and `productbuild` are Xcode's.

`--arch x64` or `--arch arm64` keeps that one architecture of the universal host, taken out with
`lipo` after it is stripped; `--arch all`, the default, keeps both.

A `dmg` stops before anything builds when its signing identity or notary credentials are missing,
naming them. `--skip-notarize`, for testing a `dmg` on this Mac only, makes it without them: signed
with `NGN_SIGN_IDENTITY` when that is set and ad hoc when not, with the hardened runtime, and never
sent to Apple. An ad hoc signature has no Team ID for library validation to check
`hermesvm.framework` against, so the app, not the framework, is signed with
`com.apple.security.cs.disable-library-validation`. Gatekeeper refuses such a disk image on any
other Mac. Sparkle (`--feed-url`) still needs `NGN_SIGN_IDENTITY` there, since it loads only into an
app signed with a Team ID.

## `Info.plist` keys

The host reads these `Info.plist` keys when it is opened with no arguments:

| Key                                                      | What it holds                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NGNBundleFile`                                          | The bundle in `Resources`: `main.jsbundle`                                                 |
| `NGNModuleName`                                          | The registered app to start: `main`                                                        |
| `NGNDistribution`                                        | `app`, `dmg` or `mas`, which says what is absent                                           |
| `NGNCapabilities`                                        | The plugin options' `capabilities`: `spawn`, `env` and `paths`                             |
| `NGNUpdatesURL`                                          | `updates.url`, the bundle server                                                           |
| `NGNRuntimeVersion`                                      | `runtimeVersion`, where it is a string                                                     |
| `SUFeedURL`                                              | Sparkle's appcast, in a `dmg` packaged with `--feed-url`                                   |
| `SUPublicEDKey`                                          | Sparkle's public EdDSA key, from `--sparkle-key` or `NGN_SPARKLE_PUBLIC_KEY`               |
| `SUEnableAutomaticChecks`                                | `true` beside a feed, so Sparkle checks without asking first                               |
| `NGNUpdatesCodeSigningCertificate`                       | The PEM at `updates.codeSigningCertificate`, which update manifests are checked against    |
| `NGNUpdatesCodeSigningKeyId`, `NGNUpdatesCodeSigningAlg` | `updates.codeSigningMetadata`'s `keyid` and `alg`: `main` and `rsa-v1_5-sha256` unless set |

`--feed-url` copies `Sparkle.framework` from the host build's `appkit` folder, and stops when the
build has none, or when there is no public key to check updates with.

## Updates

With `NGNUpdatesURL` set, the host takes Expo Updates (protocol 1) from that server: the launch
asset and each of the update's other assets, every one checked against the manifest's hash. React
Native's resolver finds a bundle's images beside it, through `SourceCode`'s `scriptURL`, so the host
lays an update's assets out as its bundle registers them, from the `registerAsset` calls Metro
writes into a JavaScript bundle. A Hermes bytecode bundle's registrations cannot be read, so its
assets are kept by their key, the file hash, and `NgNativeUpdates.localAssets` maps each key to its
`file:` URL. In a `macos` bundle, `@ng-native/metro` gives React Native's `resolveAssetSource` a
transformer that looks there first, by the file hash of the scale it picks, as `expo-asset` does
with `expo-updates` on iOS and Android.

A Linux package takes JavaScript updates the same way, from the `updates.url`, runtime version and
code-signing certificate that `metadata.json` holds, and keeps them in
`$XDG_DATA_HOME/<app id>/updates`, outside the install folder, which a `deb`, `rpm` or Flatpak
installs read-only. The host itself is
updated as a new package, by the package manager or Flatpak: `checkForAppUpdate()` resolves
`false`. An update downloaded before such a package update does not run over the new package's
bundle.

## Linux packages

`ng-native-desktop package --os linux [--format app|deb|rpm|flatpak] [--arch x64|arm64|all]
[--output <dir>] [--license <spdx>] [--homepage <url>] [--categories <list>] [--maintainer <text>]`
checks everything before it builds anything: the formats' needs, the flags, the application id and
that `NGN_GPG_KEY`, where set, has a `gpg` to sign with. It then takes the host of each
architecture (a [prebuilt one](#prebuilt-hosts) or a build from source), bundles with
`expo export:embed --platform linux`, and compiles the bundle once to Hermes bytecode with the
`hermesc` that sits beside the host, since bytecode does not depend on the architecture.

Each architecture's package holds the same tree, laid out as a prefix:

| Path                                            | What it holds                                         |
| ----------------------------------------------- | ----------------------------------------------------- |
| `bin/<name>`                                    | a link to the host                                    |
| `lib/<name>/ngn-app`                            | the host, stripped                                    |
| `lib/<name>/main.jsbundle`                      | the bytecode bundle, with the assets beside it        |
| `lib/<name>/metadata.json`                      | what the host reads before JavaScript runs            |
| `share/applications/<app-id>.desktop`           | the desktop entry                                     |
| `share/icons/hicolor/<n>x<n>/apps/<app-id>.png` | the icon, at each of 16 to 512 up to its own size     |
| `share/metainfo/<app-id>.metainfo.xml`          | the AppStream metainfo                                |
| `share/dbus-1/services/<app-id>.service`        | the D-Bus service, in a `deb`, an `rpm` and a Flatpak |

`metadata.json` is the Linux counterpart of the `Info.plist` above, with the same keys the host
reads: `CFBundleName`, `CFBundleIdentifier` (the application id), `CFBundleShortVersionString` and
`CFBundleVersion`, `NGNBundleFile`, `NGNModuleName`, `NGNDistribution` (`app`, `deb`, `rpm` or
`flatpak`), `NGNCapabilities`, `NGNUpdatesURL`, `NGNRuntimeVersion`, and the updates code signing
certificate with its key id and algorithm. The desktop entry's `MimeType` lists the plugin options'
`documentTypes[].mimeTypes` and an `x-scheme-handler` type for each URL scheme, its `Exec` takes
`%U`, and `StartupWMClass` is the application id, which is how Wayland matches a window to the
entry. In a `deb`, an `rpm` and a Flatpak it is `DBusActivatable=true`, with the service starting
the host as `--gapplication-service`, so the session bus starts the app for a link or a file and
hands them to one already running.

- **`app`** is the folder and a `<name>-<version>-<x86_64|aarch64>.tar.gz` of it, run with
  `bin/<name>`. With `NGN_GPG_KEY` set it has a detached `.tar.gz.asc` too.
- **`deb`** is written in JavaScript, into `/usr`. It depends on `libc6` 2.34, `libgtk-4-1` 4.10,
  `libadwaita-1-0` 1.4, `libsecret-1-0`, `glib-networking`, GStreamer 1.22 (`libgstreamer1.0-0`,
  `libgstreamer-plugins-base1.0-0`, and the `gstreamer1.0-plugins-base`, `-plugins-good` and
  `-pulseaudio` plugins), `libssl3t64`, `libnghttp2-14`, `zlib1g`, `libsqlite3-0`, `libatomic1`
  and `libstdc++6`, under the names Debian 13 and Ubuntu 24.04 share. It recommends
  `gstreamer1.0-pipewire` (the camera's stream), and suggests `gstreamer1.0-plugins-bad` (AAC and
  HLS) rather than recommending it, since Debian's and Ubuntu's bad plugins depend on openh264, an
  H.264 decoder. It has a `Maintainer`, from `--maintainer`.
- **`rpm`** is built by `rpmbuild` for each architecture, into `/usr`. It requires `gtk4` 4.10,
  `libadwaita` 1.4, `libsecret`, `glib-networking`, GStreamer 1.22 (`gstreamer1`,
  `gstreamer1-plugins-base`) and `gstreamer1-plugins-good`, recommends
  `gstreamer1-plugins-bad-free` and `pipewire-gstreamer`, and rpm adds a requirement for each
  library the host links. `rpmsign` signs it with `NGN_GPG_KEY`.
- **`flatpak`** is built by `flatpak-builder` on the GNOME runtime 50 into one OSTree repository,
  `flatpak-repo`, the app's own remote, and a `.flatpak` bundle of each architecture. The manifest,
  `<app-id>.json`, and the source archives it builds from are written beside them. Its permissions
  are the display (Wayland, with X11 as the fallback), shared IPC, GPU access and the network; the
  sound server when the app has `expo-audio` or `expo-video` installed, or a microphone usage
  string; and a `--filesystem` for each path in
  the plugin options' `capabilities.paths`, read only unless it says `readwrite`. Files, links,
  notifications and secrets go through [portals](/packages/desktop/portals), which need none.
  Before it builds, `package` warns about what the sandbox takes away: `capabilities.spawn`, since
  `Processes.spawn` reaches only programs in the runtime or the app, and a path in
  `capabilities.paths`, which Flathub reviews, or one that is a path the runtime keeps for its own
  (`/usr`, `/etc` and the like). With `NGN_GPG_KEY` set the repository's commits and summary are
  signed. An architecture other than the machine's needs QEMU's binfmt handlers.

`glib-networking` is the GIO module through which GLib's proxy resolver reads GNOME's and KDE's
proxy settings. The host loads it rather than linking it, so neither dpkg nor rpm's scanner would
find it, and the `deb` and the `rpm` name it themselves; without it, an app installed from either
does not follow the desktop's proxy settings. A Flatpak's GNOME runtime has it.

`package` makes packages and not repositories. To serve a `deb` or an `rpm`, add it to an apt or dnf
repository with the distribution's own tools and sign the repository with the key; the package
manager then updates the app. For a Flatpak, serve the `flatpak-repo` folder over HTTPS:

```sh
flatpak remote-add --if-not-exists my-app https://example.com/repo --gpg-import=key.gpg
flatpak install my-app dev.example.MyApp
```

An application id is the bundle identifier, with two or more parts of letters, digits, `_` and `-`,
none starting with a digit, and a Flatpak's has three to five, with a dash only in the last. Its
`<app-id>.metainfo.xml` file name must fit in the 100 bytes an archive header holds, and the
package name, the slug, takes 64 characters at most.

## Prebuilt hosts

An app with no native desktop code of its own compiles nothing when `prebuilt.json` has a host for
its React Native version, which each release has for React Native 0.88.1. Each version has two,
both universal and packed with their `hermesc`, `hermesvm.framework` and Sparkle: `run` downloads
the debug host, the dev build with React Native's
debugger, and `package` the release host, the Release build without it. Each unpacks into the
per-user cache under its hash. Each archive's SHA-256 is in `prebuilt.json`, inside the npm package,
and a download that does not match it is deleted and stops the command. The host is built from
source instead when the app links a library's or its own native desktop code, when a host library it
has installed (`react-native-screens`, `react-native-safe-area-context`, `react-native-svg`,
`react-native-webview`, `react-native-worklets`, `react-native-reanimated`) is another version than
the prebuilt one or one the prebuilt host lacks, when the prebuilt host has a library the app
denies, when `prebuilt.json` has no host of the command's flavour for its React Native version, when
the download fails (with a warning), and when `NGN_DESKTOP_FROM_SOURCE=1` is set.

The host's `ngn-macos`, `hermesc` and `hermesvm.framework` are signed ad hoc with the hardened
runtime, with no Developer ID, and `ngn-macos` with library validation off, since an ad hoc
signature has no Team ID to check the framework against: `package` signs the app, host included,
with the app's own identity, and the download is checked by the SHA-256 in `prebuilt.json`. Each
release attaches both prebuilt hosts to the GitHub release.

Linux has the same two flavours for each architecture, x64 and arm64, built on AlmaLinux 9 so they
need glibc 2.34 at most, each packed with its `hermesc` and not signed. `run` on Linux and `package
--os linux` take the one for the architecture they need, on the same terms as above. A Mac
packaging for Linux therefore needs no Linux machine for an app with no native desktop code of its
own; an app with some builds its Linux host on Linux of that architecture.
