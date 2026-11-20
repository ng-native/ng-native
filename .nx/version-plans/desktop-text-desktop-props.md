---
__default__: patch
---

On macOS and Linux, a `<text>` carries the desktop props a `<view>` carries: a heading's `aria-level` (`accessibilityLevel`), `aria-describedby`, `aria-required`, `aria-invalid`, `aria-posinset`, `aria-setsize`, `aria-rowcount`, `aria-colcount`, and `tabIndex` and `focusable` among the rest. The desktop host dropped them on a `<text>` before, so `<text role="heading" aria-level="2">` was a heading with no level.
