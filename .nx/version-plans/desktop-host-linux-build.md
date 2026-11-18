---
__default__: patch
---

The desktop host's core, Hermes and runtime build on Linux, with no backend yet: `native/scripts/build.sh --backend none --runtime` builds Hermes over a pinned static ICU 77.1 and the runtime half, and runs their tests with `--test`.

On macOS, a host built from source builds Hermes again once after the upgrade, since the record of what a cached Hermes was built for has moved to a new file.
