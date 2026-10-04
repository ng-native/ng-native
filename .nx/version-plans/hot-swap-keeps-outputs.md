---
__default__: patch
---

A component with a `model()` or an `output()` keeps them through a hot template or style swap. After an external stylesheet was edited, every later cold start applied the swap before the component first rendered and turned its outputs round, so a custom form control under `[formField]` was rejected with NG01914 until Metro was restarted with `--clear`.
