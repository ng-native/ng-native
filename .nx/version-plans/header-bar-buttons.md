---
__default__: patch
---

In `@ng-native/router`, a `<native-header-item>` at the `left` or the `right` with no content and a `systemImageName` or a `title` is a native `UIBarButtonItem` on iOS, with `<native-toolbar-item>`'s inputs and `(press)`.

It commits in the header's `headerLeftBarButtonItems` or `headerRightBarButtonItems` rather than as a custom view, in its place among the side's items as written, and takes `barButtonItemStyle` (`plain` or `prominent`), `tintColor`, `disabled`, `accessibilityLabel`, `hidesSharedBackground` and `sharesBackground`. An item with content stays a custom view, as before. The new `hidden` input leaves any header item out of the bar. Android's header draws nothing for a bar button and says so once in development.
