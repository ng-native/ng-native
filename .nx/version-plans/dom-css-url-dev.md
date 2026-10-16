---
__default__: patch
---

A font or an image a DOM component's stylesheet names in a relative `url()` now loads in development, where the page fell back to another font.

The dev server serves a page from `/_expo/@dom/`, so a `url()` left relative was asked for there and failed. Each one that names a file Metro takes as an asset is now pointed at the file on Metro's dev server, `/assets?unstable_path=...`, which serves a file outside the project too, such as a package in a pnpm store at the workspace root. A `url()` to any other file, or to one that is not there, is left as written, with Expo's warning that it is not supported.
