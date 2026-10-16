---
__default__: patch
---

A `<markdown>` image is drawn at its own size once it loads, as a browser draws it, and is narrowed to the document's width, keeping its shape, only when it is wider, instead of being scaled to the document's width.

The size comes from the image's load event on iOS and Android, so a small picture such as an icon keeps its size. An image is still drawn at the document's width with a 200-point height until it loads. A class of the app's own given for `img` in `classes` sets the width instead. On the web host the load event carries no size, so an image there keeps the document's width.
