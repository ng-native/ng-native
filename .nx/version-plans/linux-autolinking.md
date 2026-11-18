---
__default__: patch
---

The desktop build's autolinking is per desktop OS. A library lists `linux` among the `platforms` of its `expo-module.config.json`, with a `linux` entry naming its CMake target and folder as `macos` does, and an app's own modules go in `modules/<name>/linux/`; each OS reads only its own entry and folders, and a dependency with desktop code for one OS only is listed as having none on the other. `.expo/ng-native-desktop/link.json` now names its OS, and the host's CMake build refuses a file made for another OS than its backend's (gtk for Linux, appkit for macOS), reading a file with no OS as macOS. macOS autolinking is unchanged. There is no Linux desktop host yet, so this links nothing on a device.
