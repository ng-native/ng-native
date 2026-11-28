---
__default__: patch
---

`@ng-native/web-compat` now draws a box's `mask-image` of one SVG, as Taiga UI and Iconify write their icons: the SVG is drawn in the colour the box would paint, sized and placed as the mask's first layer is, under what the box holds. Taiga UI's icons, a checkbox's tick, an accordion's chevron and a notification's symbol among them, were drawn as nothing before.

A `data:` URL is read where it is, and any other is fetched against the page's address once for all the boxes that name it, and again for a box named later where that fetch failed. A box whose mask image cannot be fetched paints no background of its own, and nothing is drawn for its mask.

A drawing's `stroke-linecap` and `stroke-linejoin`, set on the `<svg>` as Lucide's icons set them, are now handed down to its shapes, as SVG hands them down.
