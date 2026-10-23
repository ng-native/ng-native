---
'__default__': patch
---

`UiBottomSheet` in `@ng-native/expo` takes `interactiveDismissDisabled`, `backgroundInteraction` and `modifiers` inputs, so a sheet can stay up against a swipe and, on iOS 16.4 and later, leave the screen behind it to take touches.

On iOS `interactiveDismissDisabled` is SwiftUI's `interactiveDismissDisabled`: a swipe down takes the sheet to its smallest detent and no further. On Android it turns off the swipe, the back button and a tap outside the sheet, and with them the drag between the sheet's half and full heights, which Compose's sheet cannot keep without the swipe. `backgroundInteraction` is SwiftUI's `presentationBackgroundInteraction`, taking `'automatic'`, `'enabled'`, `'disabled'` or `{ upThrough: <detent> }`, and is iOS only: Android has no equivalent. `modifiers` adds SwiftUI modifiers after the sheet's own presentation modifiers, on iOS only. The new `UiBottomSheetBackgroundInteraction` type is exported. Every Android sheet now commits `sheetGesturesEnabled` and `properties` to Compose's sheet, at their defaults unless dismissal is disabled.
