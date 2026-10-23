---
'__default__': patch
---

`<native-header tabBarHidden>` hides the tab bar while its page is the one in front of the tab in front, for a detail or editor page pushed in a tab's stack, as UIKit's `hidesBottomBarWhenPushed` does.

The bar comes back when the page is popped or covered by another push, when another tab is selected, and when the header goes or the input turns false. A `[barHidden]` bound on `<native-tabs-outlet>` overrides every page's request. The bar appears and disappears without UIKit's slide, since react-native-screens hides it on the tab bar as a whole. `<native-tabs-outlet>` now commits `tabBarHidden` as `false`, rather than leaving it unset, while nothing hides the bar.
