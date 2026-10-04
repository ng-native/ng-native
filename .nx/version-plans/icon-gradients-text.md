---
__default__: patch
---

`<ng-icon [svg]>` draws `<defs>`, `<linearGradient>`, `<radialGradient>`, `<text>` and `<tspan>`, so a shape can have a gradient fill or stroke with `fill="url(#id)"` and a wordmark can be gradient text. A stop written as `currentColor` takes the icon's `color` input. A tag that is still not drawn is named in a development warning, where it was left out in silence.
