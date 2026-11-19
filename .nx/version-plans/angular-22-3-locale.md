---
__default__: patch
---

`@ng-native/platform` and `@ng-native/web` work with Angular 22.3, which removed the internal `ɵsetLocaleId` they called at mount. On 22.3 a web app's Vite build failed with `"ɵsetLocaleId" is not exported by @angular/core`, and a native app threw when it mounted. On 22.3 a template's plurals read `LOCALE_ID` from the app's injector, so an app's `LOCALE_ID` still picks the plural rules there, as it does on 22.2 and earlier.
