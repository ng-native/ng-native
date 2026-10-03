---
__default__: patch
---

`pointer-events` is inherited, and a descendant that sets `pointer-events: auto` inside a `pointer-events: none` element takes touches again, as on the web, where it took none.

An element that computes to `none` is committed as React Native's `box-none` while something inside it takes touches again, and as `none` otherwise. The `pointerEvents` prop keeps React Native's meaning, where `none` is the whole subtree.
