---
__default__: patch
---

`@ng-native/nativescript` calls iOS and Android APIs from TypeScript through `@nativescript/react-native`, and shows native views built in TypeScript.

`provideNativeScript()` installs the runtime, `NativeScript.call()` runs a function for the platform on the JavaScript thread, `runOnUI()` runs a function on the platform's main thread, `<ns-view>` shows a UIView or an Android View a worklet builds, and `androidContext()` is the Activity to build an Android view with. The app's config plugins list `"@ng-native/nativescript"`. See https://ng-native.com/packages/nativescript.
