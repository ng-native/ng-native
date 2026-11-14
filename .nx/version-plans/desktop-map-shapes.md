---
__default__: patch
---

On macOS an `<expo-map>`'s polylines, polygons and circles draw on screen in their colours: MapKit asked for each shape's look as the shape was added, before the host had the props it came with, and kept a renderer that drew nothing.
