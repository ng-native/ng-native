---
__default__: patch
---

On iOS, a `ui-bottom-sheet` whose content is in a navigation stack puts its `modifiers` on the content inside that stack, so `ignoreSafeArea` lets the content run under the home indicator.

The content is in a navigation stack where the build has SwiftUI's toolbar (`@expo/ui` 57.0.20 and later) and the sheet is not sized to its content. The stack sets up the safe area again for what is inside it, so the modifiers were outside its reach on the `ui-group`; they are now on the `ui-zstack` inside the stack, and the sheet's own presentation modifiers stay on the group. Presentation modifiers given this way, such as `presentationCornerRadius`, still apply. A content modifier such as `background` or `padding` there applies below the sheet's bar, where it has one. A sheet sized to its content, and a build without the toolbar, are unchanged.
