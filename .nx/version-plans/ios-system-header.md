---
__default__: patch
---

`withHeaderDefaults({ systemBar: true })` gives every `<native-header>` with no background of its own the system navigation bar on iOS 26 and later: clear and unlined, with the content scrolling under it and blurring out.

The default is unchanged: a header nobody configured is still the opaque neutral bar. The system bar is over the page, so the page's scroll view takes `contentInsetAdjustmentBehavior="automatic"`. `OS_VERSION` from `@ng-native/device` is the major version of the operating system, which a test can provide.
