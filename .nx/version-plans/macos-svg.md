---
__default__: patch
---

On macOS, the desktop host draws `react-native-svg`'s views with Core Graphics when the app has `react-native-svg` installed, so `@ng-native/icons` draws there: groups, paths, rects, circles, ellipses and lines, linear and radial gradients, clip paths, luminance masks, `use` and `symbol`, images and text. Markers, patterns, filters, `foreignObject` and `textPath` draw nothing yet.
