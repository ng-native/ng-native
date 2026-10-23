---
'__default__': patch
---

On Expo SDK 57 and earlier, the build now warns about an `@font-face` that declares a weight range, such as `font-weight: 200 800`, because expo-font registers only a variable font's default instance there.

On those versions iOS draws that instance at every weight, and Android draws it below 700 and its system font from 700. From Expo SDK 58 the text's `font-weight` picks the instance (on iOS the nearest named instance, on Android 10 and later from the `wght` axis), and the build does not warn. The Fonts page now says what each platform draws on each SDK, and to declare one file per weight before SDK 58. The face is still registered as before.
