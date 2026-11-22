---
__default__: patch
---

By default, building the desktop host from source on Linux compiles it with clang, as it already compiled Hermes and ICU.

Before, CMake took the system's `cc` and `c++`, which is GCC on most distributions, and the build failed on React Native's `#pragma mark`. `CC` and `CXX`, where set, are left for CMake to read, flags and all. The toolchain check before a Linux build no longer prints unzip's usage text to the terminal.
