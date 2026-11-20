---
__default__: patch
---

The GTK desktop host on Linux builds `react-native-worklets` and `react-native-reanimated` in, as the macOS host does, so an app that has them builds its Linux host. Worklets run on GTK's main thread, and Reanimated's animations take their frames from the frame clock of a shown window, the active one first, or from a 60 Hz timer while no window is shown, with none requested while nothing animates.
