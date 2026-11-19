---
__default__: patch
---

A Linux `.deb` or rpm made by `ng-native-desktop package` no longer depends on GStreamer and its base plugins, which the GTK host does not link, so they are not installed with the app.
