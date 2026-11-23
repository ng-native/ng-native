---
__default__: patch
---

On a `<virtual-list>` whose sticky rows are placed from JavaScript, as they are where React Native's native animated module is absent, a pinned row is now pushed off by the next sticky row as it arrives, as it is where native moves sticky rows, rather than staying at the leading edge over that row until it is replaced.

This holds with `itemHeight` and with rows that size themselves.

Where native moves sticky rows, a sticky row that the next one follows with no space between them is now held at its own place: it has nowhere to pin, and used to follow the scroll behind that row for as long as it was rendered.

A sticky row that a list already scrolled gains, from new `items` or new `stickyIndices`, is now pinned where the list is. It used to be placed against the offset the list had when it last had a sticky row, or the top, until the next scroll event.

A sticky index past the last item now does nothing until its row arrives. On a list in columns, or with a function for `itemHeight`, it used to count as a row at the end of the rows, which showed where a `contentInset` lets the list scroll past them: where native moves sticky rows it pushed the last sticky row off there, and as the only sticky index it stopped a `stickyHeader` there.
