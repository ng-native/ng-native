---
__default__: patch
---

On macOS the desktop host draws `<expo-map>` with MapKit: markers, polylines, polygons, circles, the camera, the map type and controls, and the colour scheme, with iOS's `cameraMove`, `mapClick`, `markerClick` and shape click events. `setCameraPosition()` and `selectMarker()` work through its `NgNativeMaps`. The map shows the user's location only once location is allowed.
