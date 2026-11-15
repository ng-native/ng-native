---
__default__: patch
---

`@ng-native/router` adds `SidebarItemPath`, the `sidebar-item[path]` directive: the route selects the item with `<native-tab>`'s matching, the longest path that starts the url winning, and choosing the item navigates to its path. A tab bar on macOS is the window's sidebar, and a `<native-tab>` naming only a `drawable` warns there, as it does on iOS, that it has no icon.
