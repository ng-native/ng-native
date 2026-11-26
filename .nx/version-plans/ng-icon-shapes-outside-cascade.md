---
__default__: patch
---

`<ng-icon>` costs less on a screen with many of them, since a `color` or `size` bound on an icon with no text, no gradient and no paint from a CSS custom property now restyles and re-commits only the icon's own view.

Before, a colour change restyled every shape in the icon and re-committed each one, and so did a size change on an icon with a colour bound. Across 1,000 outline icons in the Node bench, a colour change takes about 55% less JavaScript time, a size change about 50% less, and drawing them all about 25% less. The shapes of those icons no longer commit the text colour and font they inherited and never drew with: react-native-svg paints a `currentColor` shape from the drawing it is in.

A markup is parsed once and shared by every icon that draws it, while it is among the 500 kept; past that the store is emptied and each markup parsed again when next drawn. Each of its elements is translated to native props once and reused by the icons drawn after it with the same stroke width, except a gradient, which reads the `color` input.
