---
__default__: patch
---

On macOS the host builds with `react-native-gesture-handler` and `react-native-keyboard-controller` among its libraries: a library's own component C++ is found outside `common/cpp` (gesture handler's `shared/shadowNodes`), and a descriptor's header is found by what it declares, whatever its file is named.
