---
__default__: patch
---

On macOS the desktop host links React Native's own prebuilt Hermes, the `hermesvm.framework` and `hermesc` its iOS apps use, downloaded from Maven Central and checked against the SHA-1 published there, instead of building Hermes from source, so a build from source no longer compiles Hermes.

The dev build links the Hermes with the debugger and a Release build the one without it. `ng-native-desktop package` puts `hermesvm.framework` in the app's `Contents/Frameworks` and signs it before the app with the same identity. The ad hoc signed prebuilt hosts, and a `--skip-notarize` dmg signed ad hoc (no `NGN_SIGN_IDENTITY`), have no Team ID for the hardened runtime's library validation to check the framework against, so they are signed with `com.apple.security.cs.disable-library-validation`. The prebuilt hosts carry the framework beside `ngn-macos`. Linux keeps building Hermes from source.
