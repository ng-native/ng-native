---
__default__: patch
---

`@ng-native/desktop` hits a moved, scaled or rotated view on macOS where it is drawn, and reports touch, pointer and gesture positions in the view's own transformed coordinates. A transform set by a commit, such as a CSS `rotate` or `translate`, is now kept on the view instead of being reset by AppKit.
