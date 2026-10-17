# @ng-native/nativescript

Every iOS and Android API from TypeScript, and UIKit views built in TypeScript, through
[NativeScript](https://nativescript.org)'s runtime.

Alpha: APIs may change before 1.0.

## Install

```sh
npx expo install @ng-native/nativescript @nativescript/react-native react-native-worklets
npm install --save-dev @nativescript/types-android
```

Add `"@ng-native/nativescript"` to the plugins in `app.json`, then rebuild the app: NativeScript
needs a development build, not Expo Go.

## Example

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { NativeScript } from '@ng-native/nativescript';

@Component({
  selector: 'app-device-name',
  imports: [Text],
  template: `<text>{{ model }}</text>`,
})
export class DeviceName {
  private readonly native = inject(NativeScript);

  protected readonly model = this.native.call({
    ios: () => UIDevice.currentDevice.model,
    android: () => android.os.Build.MODEL,
  });
}
```

With `provideNativeScript()` among the providers `mount` is given.

## What's in the package

- `provideNativeScript()`: installs the runtime, at bootstrap or as a route is entered.
- `NativeScript`: `call()` on the JavaScript thread, and `runOnUI()` on the UI thread.
- `<ns-view>` and `nsView()`: a UIView built in a worklet, sized by the template. iOS only.

The documentation is at
[ng-native.com/packages/nativescript](https://ng-native.com/packages/nativescript).
