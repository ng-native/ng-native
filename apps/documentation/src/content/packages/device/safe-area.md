---
title: Safe area insets
summary: The insets `SafeArea` reports, and how `<safe-area-provider>` feeds them in.
---

# Safe area insets

`SafeArea` reports how much of each edge belongs to the system: the notch, the status bar, the home
indicator, a rounded corner, and on Android the display cutout and the navigation bar.

```ts
import { Component, inject } from '@angular/core';
import { SafeArea } from '@ng-native/device';

@Component({
  selector: 'app-floating-button',
  template: `<pressable
    [style.marginBottom]="safeArea.insets().bottom + 16"
    (press)="onPress()"
  />`,
})
export class FloatingButton {
  protected readonly safeArea = inject(SafeArea);

  protected onPress(): void {}
}
```

Unlike every other service in this package, `SafeArea` has no React Native module behind it and no
`SOURCE` token to override in a test. Insets are a property of a _view_, not of the device, and the
only thing that can report them is a native view inside the window: `<safe-area-provider>` in
`@ng-native/components`, which measures itself and calls `report()`. That is also why the values
start at zero - nothing is known until a view has been laid out, which is one frame after the app
mounts.

`insets` is `{ top, right, bottom, left }`, in points, and starts at all zeroes until the provider
has measured. `frame` is the provider's own frame - the area it was handed to lay out in, which on
Android 15 includes the system bars because the app draws behind them. `Screen.window` reads `frame`
rather than `Dimensions` for that reason; see the [screen](/packages/device/screen) page. `known()`
tells you whether a real measurement has arrived yet, for a layout that would rather wait than jump.

Most layouts should not read `SafeArea` at all. A
[`<safe-area-view>`](/packages/components/safe-area) applies the insets natively, in the same layout
pass as everything else, without a round trip through JavaScript, and a screen in a native stack has
its header do it. Inject `SafeArea` for what neither covers: a floating button that must clear the
home indicator, a scroll view computing its own content inset, a sheet drawing its own chrome.

`report()` is called by `<safe-area-provider>`, not by an app. An inset written from anywhere else
is a number that stops matching the screen the moment the device rotates.

## Off a device and on the web

Off a device `insets` stays at all zeroes and `known()` stays `false` forever, because nothing ever
calls `report()` without a provider laid out somewhere. On the web there is no equivalent concept,
so an app that only targets native should still guard behavior that depends on `known()` rather
than assuming a provider is always mounted above it.

## Reference

<!-- api: SafeArea -->
