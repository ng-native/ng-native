---
__default__: patch
---

On macOS `Tracking` answers from the desktop host's `NgNativeTrackingTransparency`, over App Tracking Transparency: the permission is asked only when the app declares `NSUserTrackingUsageDescription`, and `advertisingId()` is null until tracking is allowed.
