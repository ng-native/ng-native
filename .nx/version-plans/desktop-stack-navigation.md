---
__default__: patch
---

On macOS a window's toolbar leads with back and forward chevrons that follow the window's history in `@ng-native/router`, each listing its entries by route title on a press and hold or a secondary click, and a two-finger back swipe over a native stack drags the screen in front aside with the screen below it showing, going back past a third of the width and sliding home when released early. `Menus.onNavigate` listeners in `@ng-native/device` are given the number of steps a pick from those lists goes.
