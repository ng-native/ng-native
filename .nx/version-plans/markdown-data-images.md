---
__default__: patch
---

`<markdown>` draws an image written into the document as a base64 `data:` url of a raster picture, PNG, JPEG, GIF or WebP, as a web editor writes a pasted screenshot. It drew its alt text. Any other `data:` url, an SVG or HTML among them, is still drawn as its alt text, as is every scheme but `http` and `https`.
