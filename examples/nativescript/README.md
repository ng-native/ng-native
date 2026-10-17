# NativeScript

A small app that calls iOS and Android APIs from TypeScript through
[`@ng-native/nativescript`](https://ng-native.com/packages/nativescript), with no Swift, Kotlin or
Expo module of its own.

| What it shows                     | Where                   | How                                                            |
| --------------------------------- | ----------------------- | -------------------------------------------------------------- |
| The device's model, system, cores | `src/app/app.ts`        | `call()`, synchronously on the JavaScript thread               |
| A spinning SceneKit torus (iOS)   | `src/app/torus.ts`      | `<ns-view>` and `nsView()`, built and updated on the UI thread |
| A `UIAlertController` (iOS)       | `src/app/app.ts`        | `runOnUI()`, answering through `scheduleOnRN`                  |
| The setup                         | `src/main.ts`           | `provideNativeScript({ frameworks: ['SceneKit'] })`            |
| The iOS and Android types         | `src/nativescript.d.ts` | References to both SDKs' declarations                          |

NativeScript needs a development build, not Expo Go:

```sh
pnpm ios
pnpm android
```

`pnpm test` renders the app in Node, where there is no NativeScript, and again with a stand-in for
the iOS runtime.
