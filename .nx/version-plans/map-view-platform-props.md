---
__default__: patch
---

`<expo-map>` now takes the props and events `expo-maps` has on one platform only, and a Google marker's `icon`.

On iOS, `annotations` and `(annotationClick)`. On Android, `mapOptions`, `userLocation`, `contentPadding`, `(mapLoaded)`, `(mapLongClick)` and `(poiClick)`. A marker's or an annotation's `icon` takes an image as `expo-image`'s `useImage` returns it and is sent as its shared object's id, as `expo-maps`' own views send it. On macOS the desktop host draws no annotations.
