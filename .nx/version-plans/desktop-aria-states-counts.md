---
__default__: patch
---

The desktop host reads `aria-required` (`accessibilityRequired`), `aria-invalid` (`accessibilityInvalid`), `aria-posinset` (`accessibilityPosInSet`), `aria-setsize` (`accessibilitySetSize`), `aria-rowcount` (`accessibilityRowCount`) and `aria-colcount` (`accessibilityColumnCount`), which the components already committed. On macOS a view reports required through AppKit's own property, and the rest under the attribute names WebKit gives the same ARIA (`AXInvalid`, `AXARIAPosInSet`, `AXARIASetSize`, `AXRowCount`, `AXColumnCount`); a text input's field reports required and invalid itself. On Linux they are GTK's required property, invalid state, and position-in-set, set-size, row-count and column-count relations, on a text input's field too. A place in a set or a count below 1 is left out. The desktop sizing guide gives 24 points, WCAG 2.2's minimum target size, as the least a target can be on Linux.
