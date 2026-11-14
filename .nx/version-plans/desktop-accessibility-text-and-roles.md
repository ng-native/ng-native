---
__default__: patch
---

On macOS, VoiceOver reads a text's string (static text, or a heading or link named by its text), and a heading is AppKit's heading role with its `accessibilityLevel` (`aria-level`) on macOS 26 and later, and a group spoken as a heading before that. A level on a `<text>` heading does not reach VoiceOver yet; a `<view>` heading's does. Every role the components take now has a mapping: `meter` is a level indicator, `tree` and `treegrid` an outline with `treeitem` rows, the scroll views a scroll area, and the landmark and document roles a group that says what it is. A view with a role or a label keeps its children inside it, and a control, a heading or an `accessible` view is read as one element, named by the text inside it when it has no label, as on iOS.
