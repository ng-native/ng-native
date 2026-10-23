---
'__default__': patch
---

`<expo-symbol [size]>` in `@ng-native/expo` is now a point size on iOS, as SwiftUI's `.font(.system(size:))` takes it: in a development build the symbol draws as large as SwiftUI draws it, and its view is the size of the symbol's image at that point size, weight and scale rather than `size` points square.

Most symbols draw 15 to 60% larger than before, and their views are wider or taller than `size`, so layouts around them can move. `@ng-native/expo`'s iOS native module gains a synchronous `NgNativeSymbol.imageSize(name, pointSize, weight, scale)` for this. Without that module, as in Expo Go, the view stays `size` points square with the symbol fitted into it. Android is unchanged: `expo-symbols` has no Android view.
