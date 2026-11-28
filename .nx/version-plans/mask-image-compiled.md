---
__default__: patch
---

A library's stylesheet, read as a browser reads it, now keeps a mask of one SVG image: `mask-image` of one `url()` or a token holding one, the first layer of `mask-size` and `mask-position`, and the `mask` shorthand. Taiga UI's `mask-size: calc(min(1em, 100%) + 10 * var(--tui-stroke-width)) min(1em, 100%)` is read too. No native view is sent them: `Engine.setMaskDrawer` is told each box's mask, settled against the box, and `@ng-native/web-compat` draws it. A gradient or a second layer is dropped with a warning, as before.

A custom property that holds a `url()`, `--icon: url(icon.svg)`, is now kept as its text rather than dropped at build time.

In an app's own stylesheet a mask is still dropped, and the warning now says to draw an icon with `<svg>` or `@ng-native/icons`.
