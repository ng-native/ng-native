---
__default__: patch
---

`ng-native-desktop` refuses an app name that contains a path separator or is `.` or `..`, so the `.app` is always made inside the output folder.
