---
title: Package in GitHub Actions
summary: Build, sign and notarise the Mac app as a .dmg on every push, from credentials in secrets.
---

# Package in GitHub Actions

EAS Build does not build macOS apps, so a Mac app is packaged on a Mac. GitHub's macOS runners
have Xcode, which packaging needs for the app icon. `npm run package -- --format dmg` signs the app
with your Developer ID, notarises it, staples it, and writes `dist/macos/<name>.dmg`.

## What it needs

- A **Developer ID Application** certificate, exported from Keychain Access as a `.p12` with a
  password.
- An **App Store Connect API key** for notarising: its `.p8` file, its key id and its issuer id.
- `ios.bundleIdentifier` set in `app.json`.

Add these as repository secrets:

| Secret                  | What it holds                                            |
| ----------------------- | -------------------------------------------------------- |
| `MACOS_CERTIFICATE`     | The `.p12`, base64-encoded (`base64 -i certificate.p12`) |
| `MACOS_CERTIFICATE_PWD` | The `.p12`'s password                                    |
| `MACOS_SIGN_IDENTITY`   | `Developer ID Application: Your Name (TEAMID)`           |
| `APPLE_API_KEY_P8`      | The `.p8` file's contents                                |
| `APPLE_API_KEY_ID`      | The key's id                                             |
| `APPLE_API_ISSUER`      | The issuer id                                            |

## The workflow

```yaml
name: Package for macOS
on:
  push:
    branches: [main]

jobs:
  dmg:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: brew install ninja
      - run: npm ci

      - name: Import the signing certificate
        env:
          MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
          MACOS_CERTIFICATE_PWD: ${{ secrets.MACOS_CERTIFICATE_PWD }}
        run: |
          echo "$MACOS_CERTIFICATE" | base64 --decode > certificate.p12
          security create-keychain -p ci build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p ci build.keychain
          security import certificate.p12 -k build.keychain -P "$MACOS_CERTIFICATE_PWD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k ci build.keychain
          rm certificate.p12

      - name: Package
        env:
          NGN_SIGN_IDENTITY: ${{ secrets.MACOS_SIGN_IDENTITY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
        run: |
          echo "$APPLE_API_KEY_P8" > "$RUNNER_TEMP/AuthKey.p8"
          APPLE_API_KEY="$RUNNER_TEMP/AuthKey.p8" npm run package -- --format dmg

      - uses: actions/upload-artifact@v4
        with:
          name: macos-dmg
          path: dist/macos/*.dmg
```

`APPLE_API_KEY` is the path to the `.p8` file, which `notarytool` reads. The command checks every
credential before it builds anything, and names any that is missing. A notarisation Apple rejects
stops it with the submission's id, for `xcrun notarytool log <id>` with the same key.

The first package builds the desktop host from source, which needs CMake and Ninja and takes a few
minutes. The host is built into `~/Library/Caches/ng-native/desktop`, which `actions/cache` can
keep between runs.

## Updates

To have the app update itself, pass `--feed-url` with your Sparkle appcast's url: the app embeds
Sparkle, and the `.zip` it updates from is written beside the `.dmg`, for you to upload with the
appcast. See [Package the app](/packages/desktop#package-the-app).
