---
__default__: patch
---

`UiContextMenu` and `UiViewHost` are exported from the main `@ng-native/expo` entry, beside the other typed `@expo/ui` components.

They were exported only from `@ng-native/expo/expo-ui-components`, so `import { UiContextMenu, UiViewHost } from '@ng-native/expo'` failed. That entry still exports them too.
