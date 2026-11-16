---
__default__: patch
---

Interaction observers now hear an action picked from a `<native-header-item>`'s `[menu]` in `@ng-native/router`, and each segment picked in a `<segmented-control>` from `@ng-native/expo`, as a `click`.

A menu action is reported on iOS, where header bar menus are drawn, after the action runs or `(menuSelect)` is emitted, with the action's title as `label` and the `role` `menuitem`; a disabled action, or one the menu no longer has, reports nothing. A segmented control, with the `SegmentedControl` component imported, is reported on iOS and macOS after its `change`, without the segment picked.
