---
__default__: patch
---

On the GTK desktop host on Linux, a native stack's header is the window's `AdwHeaderBar`, as it is the toolbar on macOS: the front screen's title, a back button while the stack can go back, the header's left, center and right items, its bar buttons (without their menus, for now) and its search bar, which reports typing, Return, Escape, focus and blur as on macOS. A `<modal>` sheet presents as an `AdwDialog` inside the window on libadwaita 1.5 and later, and as a drawn sheet over the dimmed window on libadwaita 1.4; a cover fills the window below the header bar. Either takes the size macOS gives it, and Escape asks the app to close it. A screen presented with `present()` is not yet a sheet on Linux.

`<safe-area-provider>` from `@ng-native/components` also publishes `--safe-area-inset-titlebar-trailing`, and `SafeArea.titlebarTrailing` from `@ng-native/device` holds the same value: how far a desktop window's controls reach into the content from its trailing edge. It is `0px` on macOS, whose controls are on the leading side, on Linux, whose content stays below the header bar, and on iOS, Android and the web.
