---
__default__: patch
---

`<ng-icon>` treats an icon name, SVG tag or attribute that only exists on `Object.prototype` (such as `constructor` or `toString`) as unknown. Before, it threw during render and took the host component down with it.
