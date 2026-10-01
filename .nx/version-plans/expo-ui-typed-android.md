---
__default__: patch
---

The common typed `@expo/ui` components (`UiToggle`, `UiSlider`, `UiButton`, `UiDivider`, `UiProgress`, the stacks and `UiSlot`) now take one template on iOS and Android, and a slider's `steps` reaches SwiftUI.

They sent SwiftUI's prop and event names, which Compose does not read: a toggle's `isOn` is Compose's `value`, and its `onIsOnChange` is Compose's `onCheckedChange`. Each now sends the platform its own names and delivers Compose's events through the same outputs with the same `$event` shape, so `(isOnChange)` and `$event.nativeEvent.isOn` work on both. A button's `label` is drawn as text inside it on Android, and `<ui-button>`, `<ui-divider>` and `<ui-progress>` are registered there. A slider's `steps` was sent to SwiftUI as `steps`, which it does not read; it now gets the step size SwiftUI takes.
