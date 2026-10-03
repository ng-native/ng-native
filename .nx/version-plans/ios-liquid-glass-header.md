---
__default__: patch
---

`withHeaderDefaults({ liquidGlass: true })`, or `[liquidGlass]="true"` on one `<native-header>`, gives a header with no background of its own iOS 26's Liquid Glass navigation bar: clear and unlined, with the content scrolling under it and blurring out.

The default is unchanged: a header nobody configured is still the opaque neutral bar. The glass bar is over the page, so the page's scroll view takes `contentInsetAdjustmentBehavior="automatic"`. `OS_VERSION` from `@ng-native/device` is the major version of the operating system, which a test can provide.
