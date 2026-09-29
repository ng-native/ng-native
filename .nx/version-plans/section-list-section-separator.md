---
__default__: minor
---

`<section-list>` draws a separator at each edge of a section, as `SectionSeparatorComponent` does.
`<ng-template sectionEdgeSeparator>` is drawn between a section's header and its first item and
between its last item and its footer, and is told the section and the sections either side. It used
to be missing, and the documentation said to draw one inside the header or footer template instead.
