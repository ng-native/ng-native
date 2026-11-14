---
__default__: patch
---

`@ng-native/components` adds `<split-view>`, `<sidebar>` (`[(collapsed)]`, `minWidth`, `maxWidth`, `autosave`), `<sidebar-section>` (`title`, `collapsible`) and `<sidebar-item>` (`label`, `badge`, `sfSymbol`, `drawable`, `icon`, `[(selected)]`, `(select)`, and content that replaces the default row). The macOS desktop host draws them as a split view with a source-list sidebar. On iOS, Android and the web host they are drawn from views: two columns, or below `Screen.compact`'s width a stack whose root is the sidebar, where choosing an item shows the content and `showSidebar()` or Android's back button returns to the sidebar.
