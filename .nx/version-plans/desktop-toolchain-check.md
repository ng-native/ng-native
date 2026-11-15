---
__default__: patch
---

On macOS `ng-native-desktop` checks for Xcode or the Command Line Tools, Swift 6.0, CMake 3.25 and Ninja 1.10 before it builds the host from source, and stops with the command that installs or updates each one missing or too old. The first build for a React Native version says up front that it takes about 4 minutes. The host and Hermes are now built for macOS 14, the packaged app's minimum, and a Hermes cached for macOS 13 is built again.
