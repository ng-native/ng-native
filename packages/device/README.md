# @ng-native/device

The host: the device, the operating system, and the user's settings.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @ng-native/device
npm install @angular/core react-native
```

## Example

```ts
import { Accessibility, Keyboard, Screen } from '@ng-native/device';

export class Composer {
  private readonly keyboard = inject(Keyboard);
  private readonly screen = inject(Screen);
  private readonly accessibility = inject(Accessibility);

  protected readonly wide = computed(() => this.screen.window().width > 600);
  protected readonly clearance = computed(() => this.keyboard.height() + 16);

  protected saved(): void {
    this.accessibility.announce('Draft saved');
  }
}
```

Nothing is provided anywhere. Each service declares its own factory, so injecting it is the whole
setup, and one nobody injects is never constructed.

## What's in the package

- `Screen`, `SafeArea` - the window, the physical display, orientation and safe-area insets.
- `ColorScheme`, `Accessibility`, `Direction` - light or dark, screen reader and reduced-motion
  state, and text direction.
- `StatusBar`, `Keyboard`, `HardwareBack`, `AppState`, `DeepLinks`, `AndroidPermissions`,
  `LayoutAnimation` - the rest of the system surfaces a screen reads from.
- `Dialogs`, `Sharing`, `Vibration` - the platform's own alert, share sheet and vibration motor.
- `DevMenu` - switches in the shake menu, gone in a release build.

## Docs

- [Device](https://ng-native.com/packages/device)
- [Testing with services](https://ng-native.com/packages/testing/testing-services), for
  overriding a service's `SOURCE` token without a device underneath it
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
