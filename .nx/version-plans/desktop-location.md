---
__default__: patch
---

On macOS `Location` answers its permission, `current()` and `start()` through the desktop host's `NgNativeLocation`, over CLLocationManager. The host asks for the permission only when the app's `Info.plist` gives a location usage string.
