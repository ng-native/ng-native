---
__default__: patch
---

`<screen-safe-area-view>` in `@ng-native/router` insets a page by what covers the screen it is on, so a page that is not one scroll view starts below a Liquid Glass header and keeps the glass bar. It works on any page of a stack and on a tab, for any edge. `<tab-safe-area-view>` is the same view and keeps working; on Android both now leave the top edge alone under a header that is shown and not translucent, where it added a gap the height of the status bar.
