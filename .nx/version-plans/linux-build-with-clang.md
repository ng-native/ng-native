---
__default__: patch
---

On Linux, building the desktop host from source compiles it with clang, as it already compiled Hermes and ICU, unless `CC` and `CXX` name other compilers. Before, CMake took the system's `cc` and `c++`, which is GCC on most distributions, and the build failed on React Native's `#pragma mark`. The toolchain check before a Linux build no longer prints unzip's usage text to the terminal.
