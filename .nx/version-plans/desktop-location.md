---
__default__: patch
---

On macOS `Location` answers its permission, `current()` and `start()` through the desktop host's `NgNativeLocation`, over CLLocationManager, where it threw that the host had no module. The host asks for the permission only when the app's `Info.plist` gives a location usage string. `geocode()` and `reverseGeocode()` stay empty on macOS.
