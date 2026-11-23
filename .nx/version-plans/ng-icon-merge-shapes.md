---
__default__: patch
---

`<ng-icon>` draws the shapes of an outline icon that share one stroke and no fill as a single native path, so a lucide icon commits half as many native views and a tabler, feather, iconoir or huge-icons icon a quarter to a third fewer.

Shapes merge only where one path draws them as they were drawn apart: next to each other, with no fill, no opacity, dash or marker, the same paint and not a gradient or pattern, no value from a CSS custom property other than ng-icons' stroke width, no `id` another element points at, path data and points that parse to their end, and no closed shape that is no wider or taller than its stroke at the stroke width the icon draws with. A stroke merges only in an opaque colour: two strokes crossing in a colour with any transparency are darker drawn apart, as the web draws them, so `currentColor` shapes merge only while the icon's colour, from its `color` input or a stylesheet, is opaque, and an icon draws its shapes apart again when its colour stops being opaque. A stylesheet's colour is checked once a commit settles it, so an icon new in a commit whose own stylesheet colour is not opaque, where its parent's is, draws its crossings lighter in that one commit. Every other shape is drawn as before. Across 1,000 lucide icons on the iOS simulator, drawing them takes about 14% less JavaScript time and 28% less main-thread time.

Where two strokes cross, edge pixels blend once rather than twice, and on iOS a stroke edge that sits on a pixel boundary can round to the pixel beside it. Every ng-icons icon the merge changes was compared with its unmerged drawing on iOS and Android, with no shape moved or missing.
