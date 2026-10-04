---
__default__: patch
---

A CSS system colour is the platform's own colour for the same thing: `Canvas` and `CanvasText` are the system background and label colours, `GrayText` the secondary label, `LinkText` the link colour, `AccentColor` the tint and `ButtonFace` the secondary background, each following light and dark. A deprecated one (`Window`, `WindowText`, `Menu`, `ThreeDFace`) is the current colour CSS says it now is. One with no such colour (`Highlight`, `SelectedItem`), or one inside a shadow or a gradient, is dropped with a warning. Each was passed to the view as its keyword, which no view reads as a colour.
