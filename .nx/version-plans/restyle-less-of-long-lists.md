---
__default__: patch
---

Less of a long child list is styled again as it changes, where a stylesheet asks about places in one:

- Rows added or removed one at a time mark each row before or after the change once a commit, not once for each change: a chart appending or removing thousands of points no longer takes quadratic time.
- A rule that reads an element's place from under it (`text:nth-child(odd) .label`) restyles under elements of its own name only.
- A class change is weighed against `[class^=...]` and `[class$=...]` by the whole attribute before and after, rather than restyling everything under the element for any class.
