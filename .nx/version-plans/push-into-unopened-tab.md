---
__default__: patch
---

`NativeNavigation.push()` to a page of a tab that has not been opened now puts the tab's own first screen under the page, where the page was the only screen of the tab's stack, a back from it went to the tab it came from, and tapping the tab afterwards pushed its list over the page.

The push navigates to the tab's url first and then to the page, so the same push leaves the same stack whether or not the tab was ever tapped. `nativeRouterLink` does the same. `present()` and the router's own `navigate` are unchanged.
