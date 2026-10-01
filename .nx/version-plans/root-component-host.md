---
__default__: patch
---

A root component's `:host` styles now apply: `mount` gives the root component a host view of its own under the surface, filling it by default, instead of mounting it on the surface root, which is never committed and dropped its background and padding without a warning.
