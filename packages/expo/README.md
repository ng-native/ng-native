# @ng-native/expo

Expo's native modules as Angular services, and Expo's native views as elements.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @ng-native/expo
npm install @angular/core expo
```

Every Expo module (`expo-haptics`, `expo-clipboard`, `expo-file-system`, and the rest) is an
optional peer dependency: install only the ones the app actually uses.

## Example

```ts
import { Clipboard } from '@ng-native/expo/clipboard';
import { FileSystem } from '@ng-native/expo/file-system';
import { Haptics } from '@ng-native/expo/haptics';

export class Notes {
  private readonly clipboard = inject(Clipboard);
  private readonly files = inject(FileSystem);
  private readonly haptics = inject(Haptics);

  protected async save(text: string): Promise<void> {
    this.files.write(this.files.document('notes.txt'), text);
    await this.clipboard.write(text);
    this.haptics.notify('success');
  }
}
```

One entry point per module, so importing haptics does not bundle the file system. Nothing is
provided anywhere - injecting a service is the whole setup, and a service nobody injects is never
constructed. See [Using a module](https://ng-native.com/packages/expo/using-a-module) for how the
`exports` map and the runtime fallback behind each service work.

## What's in the package

- Device state - `Battery`, `Brightness`, `Network`, `Orientation`, `Locale`, the sensors, `Fonts`,
  `AppInfo`, `KeepAwake`.
- Feedback - `Haptics`, `Clipboard`, `Notifications`, `StoreReview`.
- Storage and files - `Storage`, `SecureStorage`, `FileSystem`, `database()`, `assets()`.
- Media and camera - `ImagePicker`, `DocumentPicker`, `ImageEditor`, `MediaLibrary`, the `Camera`
  directive, `videoPlayer()`/`audioPlayer()`.
- Location and identity - `Location`, `Biometrics`, Sign in with Apple, `Tracking`, `Crypto`,
  `ScreenCapture`, `Browser`.
- App lifecycle - `splashScreen`, `Updates`, `BackgroundTask`.
- Native views - `registerExpoView()`/`registerExpoViews()`, and the `@expo/ui` SwiftUI and
  Jetpack Compose controls.
- `Permission` - the `getXPermissionsAsync`/`requestXPermissionsAsync` pair any module exposes,
  as one class.

## Docs

- [Expo](https://ng-native.com/packages/expo), with the full module list by category
- [Using a module](https://ng-native.com/packages/expo/using-a-module) and
  [permissions](https://ng-native.com/packages/expo/permissions)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md)

## License

MIT
