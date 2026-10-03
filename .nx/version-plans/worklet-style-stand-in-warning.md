---
__default__: patch
---

Under test, a `[workletStyle]` whose worklet returns a style such as `opacity` or `height` no longer logs "has no prop" for each key: the stand-in writes what the worklet returns as styles, where it wrote them as props.
