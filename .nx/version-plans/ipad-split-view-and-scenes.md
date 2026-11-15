---
__default__: patch
---

On an iPad, in a development build (not in Expo Go), `@ng-native/components` draws `<split-view>` as a UISplitViewController: the sidebar is its sidebar column and the content its other column, `[(collapsed)]` follows the system's sidebar button, `minWidth` and `maxWidth` bound the sidebar column, and at a compact width (Slide Over, a narrow window) UIKit collapses the columns into a stack whose root is the sidebar, keeping the router's page. Sections and items stay drawn from views. iPhone keeps the drawn split view. With the new `ios.multipleWindows` option of the `@ng-native/metro` config plugin, `AppWindows` opens each window on an iPad as a scene of its own, through the `NgNativeWindows` module: `close`, `focus` and `setTitle` act on the scene, a scene iPadOS closes reports itself closed without asking `canClose` guards, and `quit()` does nothing. On iPhone `AppWindows.available()` stays `false`.
