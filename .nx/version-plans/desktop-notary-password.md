---
__default__: patch
---

`ng-native-desktop package --format dmg` no longer reads `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`, because `notarytool` takes the password only as an argument, which every process on the Mac can read. Store it in the keychain with `xcrun notarytool store-credentials` and set `NGN_NOTARY_PROFILE`, or use an App Store Connect API key.
