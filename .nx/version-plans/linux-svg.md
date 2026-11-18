---
__default__: patch
---

The GTK desktop host on Linux draws react-native-svg's elements, and so the icons from `@ng-native/icons`, which left a blank space there before. Shapes, paths, strokes with their caps, joins and dashes, gradients, patterns, clip paths, masks, filters, markers, images, text and text on a path draw as on macOS, from the same document the core builds. Unlike macOS, the views in a `foreignObject` are not drawn on Linux.
