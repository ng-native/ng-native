---
__default__: patch
---

On macOS an svg draws the views in a `foreignObject` at its `x` and `y`, cut to its `width` and `height`, and draws them again when a commit changes one of them.

As react-native-svg does on iOS, they are drawn from their layers in the object's place among the shapes, under the transforms, opacity, clip paths, masks and filters around it, so they take no clicks. What a layer does not draw into its own contents, such as a video or a visual-effect (glass) view, does not show.
