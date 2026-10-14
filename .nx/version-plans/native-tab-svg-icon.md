---
'__default__': minor
---

A `<native-tab>` icon can be SVG markup, `[icon]="{ svg: lucideHeart }"`, drawn once into a tinted template image by the renderer `withSvgIcons(SvgImages)` provides, with `SvgImages` from `@ng-native/icons`. Neither platform's tab bar draws SVG, so `SvgImages` draws the markup as an `ng-icon` beside the tab bar for a frame, asks react-native-svg for it as a PNG at the screen's scale, and removes it. The icon is 25 points square on iOS and 24 on Android unless it gives a `size`, and the tab has no icon until it has been drawn. `SvgImages.render(svg, size, at)` is public for any other place that takes an image rather than a view. `native-toolbar-item` still takes only `systemImageName`.
