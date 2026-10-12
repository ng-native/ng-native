---
'__default__': patch
---

A font or an image a DOM component's stylesheet names in a relative `url()` ships with the page in a release build, where it was left out and the page fell back to another font.

`expo export:embed` wrote the stylesheet as it was and none of the files it referred to. Each such file is now written into the page's folder in `www.bundle`, and the `url()` points at it. `withAngularNative` adds `woff` and `woff2` to Metro's `assetExts`, as only a file Metro takes as an asset is exported; a `url()` to any other file keeps Expo's warning.
