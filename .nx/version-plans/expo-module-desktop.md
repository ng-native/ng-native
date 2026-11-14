---
__default__: patch
---

`expoModule()` from `@ng-native/expo` takes `{ platforms, desktop }` as its third argument as well as a list of platforms, and `ModulePlatform` includes `'macos'`. On macOS it never calls the loader it is given: it answers the desktop host's TurboModule `desktop` names, or null where the call names none, so the service is inert. A desktop host without the named module throws a `MissingModuleError` that says to rebuild it with `npm run macos`. Where a module is provided on macOS, `Location` geocodes without asking for the permission and `Calendar` reaches the default calendar, the sources and the reminders, as on iOS; the calendar picker stays iOS only. `registerExpoMap('macos')` draws with MapKit, and `TextRecognition` says to rebuild the desktop host when its module is missing on macOS.
