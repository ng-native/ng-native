---
__default__: patch
---

Each release publishes prebuilt Linux desktop hosts, debug and release for x64 and arm64, built on AlmaLinux 9 and named in `@ng-native/desktop`'s `prebuilt.json`, so `ng-native-desktop run` on Linux and `package --os linux` on Linux or a Mac use them instead of building the GTK host, for an app with no native desktop code of its own. `make-prebuilt.mjs` takes `--os linux`.
