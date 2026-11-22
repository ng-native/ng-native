---
__default__: patch
---

On a `<virtual-list>` with `itemHeight` whose sticky rows are placed from JavaScript, a pinned row is now pushed off by the next sticky row as it arrives, as it is where native moves sticky rows, rather than staying at the leading edge over that row until it is replaced.

Where native moves sticky rows, a sticky row that the next one follows with no space between them is now held at its own place: it has nowhere to pin, and used to follow the scroll behind that row for as long as it was rendered.

A sticky index past the last item now does nothing until its row arrives. On a list in columns, or with a function for `itemHeight`, it used to count as a row at the end of the rows, which showed where a `contentInset` lets the list scroll past them: where native moves sticky rows it pushed the last sticky row off there, and as the only sticky index it stopped a `stickyHeader` there.
