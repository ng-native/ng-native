---
title: Device
summary: Signal-based services for screen size, color scheme, safe areas and the rest of the host.
---

# Device

`@ng-native/device` is the set of services that answer questions about the device and the
operating system: how big the screen is, whether the user is in dark mode, how much of the screen
the system has claimed, what the user has turned on in Settings, and whether the app is even in
front of them right now. Everything here is a signal, not an observable and not a hook, so reading
one in a template or a `computed()` is the same as reading any other piece of state.

Every service is `providedIn: 'root'` and built around an `@Service()` factory, so injecting one is
the whole setup:

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { ColorScheme } from '@ng-native/device';

@Component({
  selector: 'app-header',
  imports: [Text],
  template: `<text>{{ scheme.current() }}</text>`,
})
export class Header {
  protected readonly scheme = inject(ColorScheme);
}
```

A service nobody injects is never constructed, so there is no cost to importing the package and
using only what a screen actually needs. Reach for a service here rather than reading React
Native's own module directly - `Dimensions`, `Appearance`, `AppState` and the rest - because the
service is what turns a callback-based API into a signal a `computed()` or a template can read
without a manual subscription to tear down, and because it is what still works when there is no
device: in a unit test, in `mount`'s own bootstrap, in anything that imports this code without a
phone underneath it.

## Off a device

Every service here falls back to doing nothing when there is no React Native underneath it: no
`nativeFabricUIManager`, no listeners, and a value that just sits at its neutral default. That is
what makes the package importable by a test suite, by `mount`, and by anything else that runs this
code somewhere other than a phone. `ColorScheme` reports `light`, `Screen` reports a zero-sized
window, `AppState` reports `active`, and so on - nothing throws, and nothing waits forever for a
platform that is not going to answer.

Most services also expose a `SOURCE` injection token, which a test overrides to drive the service
without a device underneath it (`SafeArea` is the exception - it has no native module behind it,
only `report()`, which `<safe-area-provider>` calls):

```ts
import { ColorScheme } from '@ng-native/device';
import { injectService } from '@ng-native/testing';
import { expect, it } from 'vitest';

it('reads the scheme the source reports', () => {
  const scheme = injectService(ColorScheme, {
    providers: [
      {
        provide: ColorScheme.SOURCE,
        useValue: { current: () => 'dark', subscribe: () => () => {} },
      },
    ],
  });

  expect(scheme.current()).toBe('dark');
});
```

The same `providers` work in `render()`, for a component that injects the service. See
[Testing with services](/packages/testing/testing-services).

## The OS version

`OS_VERSION` is the major version of the operating system the app runs on, for a default that
follows what the platform draws in that version: `26` on iOS 26.5, and the API level on Android.
It is `null` on the web and in a test, and a test that wants a version provides one:

```ts
providers: [{ provide: OS_VERSION, useValue: 26 }];
```

## The services

**Screen**

- [Screen](/packages/device/screen) - the window, the physical display, orientation, and the
  `compact` breakpoint.
- [Safe area](/packages/device/safe-area) - the insets `SafeArea` reports, fed by
  `<safe-area-provider>`.

**Appearance**

- [Color scheme](/packages/device/color-scheme) - light or dark, as the user set it.
- [Accessibility](/packages/device/accessibility) - screen reader, reduced motion, bold text and
  font scale.
- [Direction](/packages/device/direction) - left-to-right or right-to-left.

**System**

- [Status bar](/packages/device/status-bar) - a stack of claims on style, visibility and color.
- [Keyboard](/packages/device/keyboard) - height, position and animation timing.
- [Hardware back](/packages/device/hardware-back) - claiming Android's hardware back button.
- [App state](/packages/device/app-state) - whether the app is in front of the user.
- [Deep links](/packages/device/deep-links) - the launch url and every link that arrives after.
- [Android permissions](/packages/device/android-permissions) - runtime permissions, granted
  outright on iOS.
- [Layout animation](/packages/device/layout-animation) - animating a layout change CSS cannot
  express.

**Feedback**

- [Dialogs](/packages/device/dialogs) - the platform's own alert, confirmation, prompt, action
  sheet and toast.
- [Sharing](/packages/device/sharing) - the system share sheet.
- [Vibration](/packages/device/vibration) - the phone's motor.

**Development**

- [Dev menu](/packages/device/dev-menu) - switches in the shake menu, gone in a release build.
