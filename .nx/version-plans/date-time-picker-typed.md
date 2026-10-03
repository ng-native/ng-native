---
__default__: patch
---

`DateTimePicker` from `@ng-native/expo` is a typed component over the `<date-time-picker>` element, so a strict template can bind the picker's `date`, `mode`, `displayIOS`, `minimumDate` and `maximumDate` and read `$event.nativeEvent.timestamp` from `(change)`.

`date`, `minimumDate` and `maximumDate` take a `Date` or milliseconds. The Native views page now says what the element takes and sends, and that it is iOS only: on Android the library has no view, and the element commits as nothing.
