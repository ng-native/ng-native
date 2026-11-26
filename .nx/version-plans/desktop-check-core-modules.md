---
__default__: patch
---

`ng-native-desktop run` and `package` no longer warn that `@react-native-async-storage/async-storage` and `react-native-gesture-handler` have no desktop code, since the host's core answers their native modules on macOS and Linux.

The warning said their native modules were absent and suggested adding them to `deny`, though async-storage's store and the gesture handler's recognisers work on both desktop OSes. A dependency the host does not answer is still listed.
