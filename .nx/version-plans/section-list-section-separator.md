---
__default__: minor
---

`<section-list>` draws `SectionSeparatorComponent`: `<ng-template sectionListSeparator>` is
stamped between a section's header and its first item and between its last item and its footer,
told the section either side, as React Native's is. It used to be missing, and the documentation
said to draw one inside the header or footer template instead.
