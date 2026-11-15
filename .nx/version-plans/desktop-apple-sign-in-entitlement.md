---
__default__: patch
---

`ng-native-desktop package --format mas` signs an app that uses `expo-apple-authentication` with the Sign in with Apple entitlement, as the iOS build does. `--format dmg` adds it when `ios.usesAppleSignIn` is `true`, and then needs `NGN_PROVISIONING_PROFILE` (a Developer ID profile with the capability) and `APPLE_TEAM_ID`, and embeds the profile.
