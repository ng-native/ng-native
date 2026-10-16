---
__default__: patch
---

Less of a long child list is styled again as it changes, where a stylesheet asks about places in one:

- Rows added or removed one at a time mark each row before or after the change once a commit, not once for each change: a chart appending or removing thousands of points no longer takes quadratic time.
- A rule that reads an element's place from under it (`text:nth-child(odd) .label`) restyles under elements of its own name only.
- A class change is weighed against `[class^=...]` and `[class$=...]` by the whole attribute before and after, rather than restyling everything under the element for any class.
- A style bound to a token again as it was (`fill="var(--ink)"` written again) changes nothing.
- A sibling test nested in the element's own compound (`.a ~ .x:is(.peer ~ *)`) no longer restyles everything under any element whose place changes: a chart shown again after a label beside its series came and went restyled every point.
