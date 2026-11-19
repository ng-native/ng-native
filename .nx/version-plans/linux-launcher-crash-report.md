---
__default__: patch
---

`linuxLauncher()` in `@ng-native/testing` quotes the GTK host's crash report, the signal and the native stack it writes as it crashes, in the failure of the file a crash interrupted, before the end of the host's output, whether the host ran in the AlmaLinux 9 image or not.
