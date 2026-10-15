---
__default__: patch
---

`ui-bottom-sheet` takes a `backgroundColor` input, and a `background-color` on the element from CSS, as the colour of the sheet: SwiftUI's `presentationBackground` on iOS and the container colour of Compose's sheet on Android.

On iOS 26 a sheet below its full height is drawn as glass, and there was no way to make it opaque. The colour can come from a class, a stylesheet, a Tailwind utility or `[style]`, follows a `var()` and a theme change, and is dropped when it is removed. The input wins over CSS. `Engine` gains `takePaint`, which hands a node's resolved background colour to a listener instead of painting it.
