---
__default__: patch
---

`@ng-native/device` exports an `OS` injection token beside `OS_VERSION`, so a service can gate a feature on the operating system, such as Apple Foundation Models on iOS 26, and a test can provide the OS it wants with `{ provide: OS, useValue: 'android' }`.

It is `'ios'` or `'android'` from `Platform.OS` on a device, and `'web'` in the `@ng-native/web` host, which provides it. In a test it is the platform the test renders as: `'ios'`, or `'android'` after `registerPlatformComponents('android')`. A service no longer needs to import `Platform` from `react-native`, which a Vitest spec cannot load.

Inside an island (`mount` with an `injector`, or `<ng-native-island>`), the web host provides `OS` only in the island's own injector. A root service of the host app reads `'ios'` there, so an app that uses islands and has root services that inject `OS` provides `{ provide: OS, useValue: 'web' }` in its own `bootstrapApplication` providers.
