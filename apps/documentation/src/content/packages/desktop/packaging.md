---
title: Inside a package
summary: What ng-native-desktop package runs, the Info.plist it writes, updates and prebuilt hosts.
---

# Inside a package

What `ng-native-desktop package` builds, the keys it writes, and where the host it packages comes
from.

## The build

`ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url>]
[--sparkle-key <key>] [--skip-notarize]` builds a
universal Release host (arm64 and x86_64, without the core tests, dead code stripped), bundles
with `expo export:embed --platform macos` (the assets laid out as React Native's resolver reads
them beside an embedded bundle), compiles the bundle to Hermes bytecode with the `hermesc` the
host build puts beside its binary, built from the same Hermes, and assembles
`<output>/<name>.app`: the host binary as `Contents/MacOS/<name>` with its local symbols stripped,
the bytecode bundle and assets in `Resources`, the icon compiled by `actool`, and an `Info.plist`
from the Expo keys. Then `app` is
signed ad hoc, `dmg` is signed with the hardened runtime, notarised and stapled (app and disk
image), and `mas` is signed in the App Sandbox and wrapped by `productbuild`. `codesign`,
`notarytool`, `stapler`, `hdiutil`, `ditto`, `sips`, `actool` and `productbuild` are Xcode's.

A `dmg` stops before anything builds when its signing identity or notary credentials are missing,
naming them. `--skip-notarize`, for testing a `dmg` on this Mac only, makes it without them: signed
with `NGN_SIGN_IDENTITY` when that is set and ad hoc when not, with the hardened runtime, and never
sent to Apple. Gatekeeper refuses such a disk image on any other Mac. Sparkle (`--feed-url`) still
needs `NGN_SIGN_IDENTITY` there, since it loads only into an app signed with a Team ID.

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

## Prebuilt hosts

An app with no native desktop code of its own compiles nothing when `prebuilt.json` has a host for
its React Native version: `run` and `package` download that host, the universal Release build with
its `hermesc` and Sparkle, and unpack it into the per-user cache under its hash. The archive's
SHA-256 is in `prebuilt.json`, inside the npm package, and a download that does not match it is
deleted and stops the command. The host is built from source instead when the app links a library's
or its own native desktop code, when a host library it has installed (`react-native-screens`,
`react-native-safe-area-context`, `react-native-svg`, `react-native-webview`) is another version
than the prebuilt one or denied, when `prebuilt.json` has no host for its React Native version,
when the download fails (with a warning), and when `NGN_DESKTOP_FROM_SOURCE=1` is set.

The host's `ngn-macos` and `hermesc` are signed ad hoc with the hardened runtime, with no
Developer ID: `package` signs the app, host included, with the app's own identity, and the download
is checked by the SHA-256 in `prebuilt.json`. Set `NGN_SIGN_IDENTITY` to sign them with an identity
instead.
