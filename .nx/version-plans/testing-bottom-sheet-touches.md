---
'__default__': patch
---

Under `@ng-native/testing`, a press reaches a pressable inside an open `ui-bottom-sheet`, and the `ui-toolbar-item`s written inside a sheet are in the rendered tree on iOS, as they are on a device with a development build.

A press now stops checking `pointerEvents` at a view committed with `layoutRoot`, `@expo/ui`'s view host for a sheet's or a popover's content, which takes its content's touches itself; before, the sheet's `pointerEvents: 'none'` host stopped every press inside it. While something is rendered, `render()` puts an `expo` global in place whose `getViewConfig` answers for every view, where there is no `expo` global already, and removes it once nothing is rendered. Components that ask the build whether it has a view, as `ui-bottom-sheet` does for SwiftUI's toolbar, render as they do in a development build. A test that sets its own `expo` global keeps it.
