---
__default__: patch
---

`@ng-native/testing/device` runs Vitest component tests inside the running app on a Mac, an iOS simulator or an Android emulator. A Vitest project with `deviceTests({ platform: 'macos' })` starts the desktop host with fresh state, keeps a snapshot file per platform, and after a crash fails the file that was running with the crash report's path and runs the rest on a new host.
