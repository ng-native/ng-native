---
__default__: patch
---

A `virtual-list` with `estimatedItemHeight` measures an item handed a recycled row view at the same place and size as the view's last item, so its separator is drawn and the separators below it line up with their rows after `items` changes.

React Native reports a layout only when a view's frame differs from the last one it reported, so such an item was never measured: it had no separator, and every separator below it was offset by the difference between the estimate and its real size.
