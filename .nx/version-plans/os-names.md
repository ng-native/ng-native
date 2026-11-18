---
__default__: patch
---

`@ng-native/device` exports `OS_NAMES`, the OSes Angular Native runs on, and `OsName`, the type of one of them. The `OS` token, `ShortcutOs`, `TestOs` in `@ng-native/testing` and `ModulePlatform` in `@ng-native/expo` are that type, so the next OS is added in one place.

An OS the host reports that is not in `OS_NAMES` is now an error that names it, where `OS` and the keyboard shortcuts used to read it as iOS. In a test, an `NG_NATIVE_TEST_OS` or a Vitest preset `os` outside the list fails the same way rather than testing as iOS. iOS, Android, macOS and the web host answer as before.
