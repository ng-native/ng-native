---
__default__: patch
---

The desktop template, `nx g @ng-native/nx:desktop` and `ng generate @ng-native/schematics:desktop` add a `linux` in-app Vitest project beside `macos`, and their example `app.device.ts` passes on either host. `linuxLauncher()` with no `host` and no `NGN_DESKTOP_HOST` runs the debug host the project's new `ng-native-desktop host --os linux` prints, which takes the prebuilt Linux host for the machine's architecture, on a Mac too, or builds one on Linux. `@ng-native/desktop` publishes `native/docker`, the AlmaLinux 9 image a Mac runs that host in.
