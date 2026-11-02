---
__default__: patch
---

`@ng-native/router` has a `TabBarInsets` service whose `bottom` signal is what the tab bar covers of the bottom of the window now, for an overlay outside the tabs: 0 while the bar is hidden or covered, or with no tabs.

On iOS, each opened tab of a `<native-tabs-outlet>` holds a view of no width after its page to measure the bar, and a `<safe-area-provider>` in the app is what tells an iPad's bar at the top from one along the bottom. On iOS, a page presented in a tab's own stack counts as covering the bar. On Android, it does not, since the bar stays.

On Android, the height comes from a new native module in `@ng-native/expo`, so the app needs that package and a new development build. In Android Expo Go, which cannot load it, `bottom` stays 0. The value includes the home indicator or the system navigation bar, so an overlay takes the larger of it and the safe-area inset rather than their sum.
