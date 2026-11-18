---
__default__: patch
---

`ng-native-desktop run` takes `--os macos|linux`, defaulting to the machine's OS, and on Linux runs the GTK host on the dev server's Linux bundle: a prebuilt debug host for the machine's architecture when one fits the app, otherwise the host built from source into `$XDG_CACHE_HOME/ng-native/desktop`. Before a Linux build it checks clang, lld, CMake, Ninja, the other tools the build runs and, through pkg-config, the libraries the GTK host links, and names the apt or dnf package for each problem. `run --os linux` off Linux stops with a message naming the alternative. The `linux` script and target that the desktop template, `nx g @ng-native/nx:desktop` and `ng generate @ng-native/schematics:desktop` add run `ng-native-desktop run --os linux`.
