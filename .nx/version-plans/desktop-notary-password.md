---
__default__: patch
---

`ng-native-desktop package --format dmg` notarises with a keychain profile (stored with `xcrun notarytool store-credentials`, named by `NGN_NOTARY_PROFILE`) or an App Store Connect API key. It does not take `APPLE_ID` and an app-specific password, because `notarytool` takes that password only as an argument, which every process on the Mac can read.
