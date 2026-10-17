---
__default__: patch
---

`@ng-native/nativescript` calls iOS and Android APIs from TypeScript through `@nativescript/react-native`, and shows UIViews built in TypeScript.

`provideNativeScript()` installs the runtime, `NativeScript.call()` runs a function for the platform on the JavaScript thread, `runOnUI()` runs a worklet on iOS's main thread, and `<ns-view>` shows a UIView a worklet builds, on iOS. The app's config plugins list `"@ng-native/nativescript"`. See https://ng-native.com/packages/nativescript.
