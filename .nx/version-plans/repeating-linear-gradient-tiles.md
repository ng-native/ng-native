---
__default__: patch
---

A `repeating-linear-gradient(...)` in a stylesheet now compiles to the tile that draws the same stripes, one linear gradient with `background-size` and `background-repeat`, where it used to be dropped with a build warning.

The lowering takes stops in `px` or `rem`, the first at 0 or with no position and the last with one, and a direction that is an angle or a side, on iOS, Android, macOS and Linux. Percentage, `em` and viewport stops, a first stop not at 0, a corner direction, and a `background-size` or a `background-position` in lengths written beside it in the `background` shorthand are still dropped with a build warning, which now names the tile to write instead. A `var()` in a repeating gradient, a token holding one, and `repeating-radial-gradient` are dropped with a warning as before. The tile sets that layer's background size, position and repeat.

The build error for a component whose `styles` or `host` is imported from another file now says what to write instead: a `.css` file in `styleUrl` or `styleUrls` for styles, and bindings in the same file or a directive in `hostDirectives` for a host.
