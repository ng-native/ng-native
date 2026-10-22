---
'__default__': patch
---

A stylesheet's `tint-color: platform-color(...)` and React Native's `padding-horizontal`, `padding-vertical`, `margin-horizontal` and `margin-vertical` compile, where each was dropped with a "not mapped yet" warning.

`tint-color` holds the platform colour names as `color` and the other colour properties do. Each of the four axis properties takes one length, a token or `env()` among them, for both sides of its axis, and is committed as those two sides (`paddingLeft` and `paddingRight` for `padding-horizontal`), not as React Native's `paddingHorizontal`, which some views do not read. Two lengths are refused with a warning that says it takes one.
