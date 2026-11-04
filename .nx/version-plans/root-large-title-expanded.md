---
__default__: patch
---

On iOS a stack's root page with a large title now launches with the title expanded, where it showed collapsed in the bar until the page was pulled down.

`<native-stack-outlet>` commits its `RNSScreenStack` only once its first screen has joined it, with that screen, as react-native-screens' own JavaScript does. Committed empty, the stack was laid out with a compact bar before the root page arrived, and the page's scroll view kept the offset that bar gave it. A test that reads the committed tree of an outlet with no screen no longer finds an `RNSScreenStack` there.
