---
__default__: patch
---

The macOS desktop host no longer requests a react-native-svg `<image>` again on each redraw after its request failed or its data was not an image, so a broken image stays blank while the app runs, as in a browser.

An `<image>` with a path that the file boundary refused is still checked on each draw.
