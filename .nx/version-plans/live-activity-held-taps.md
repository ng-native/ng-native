---
'__default__': patch
---

A tap on a Live Activity's button that starts the app reaches `onTaps`, where it was lost before the app's JavaScript had loaded. `@ng-native/expo` holds it in a native module of its own on iOS, so rebuild the app (`npx expo run:ios`, or a new EAS build) to get it; an app not rebuilt behaves as before.
