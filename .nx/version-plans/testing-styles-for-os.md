---
__default__: patch
---

The Vitest plugin compiles a component's stylesheet for the `os` it runs as, so a test checks CSS against that OS alone, as Metro does for the platform it bundles.

On macOS, Linux and Android a `filter` such as `grayscale(1)` is kept, where before it was dropped with the iOS warning, and an iOS project keeps a `skewX()`, which only Android refuses. A `web` project's stylesheets are compiled for iOS and Android together, as before. The warnings a test run prints change to match.
