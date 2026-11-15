---
__default__: patch
---

On macOS `Location.geocode()` and `reverseGeocode()` answer from CLGeocoder through the desktop host's `NgNativeLocation`, with no permission asked, in `expo-location`'s iOS shapes. They answered an empty list before.
