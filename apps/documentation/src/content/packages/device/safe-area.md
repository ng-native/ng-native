---
title: Safe area insets
summary: The insets `SafeArea` reports, and how `<safe-area-provider>` feeds them in.
---

# Safe area insets

`SafeArea` reports how much of each edge belongs to the system: the notch, the status bar, the home
indicator, a rounded corner, and on Android the display cutout and the navigation bar.

```ts
import { Component, inject } from '@angular/core';
import { Pressable } from '@ng-native/components';
import { SafeArea } from '@ng-native/device';

@Component({
  selector: 'app-floating-button',
  imports: [Pressable],
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
On macOS, `titlebarLeading` is how far the window's close, minimise and zoom buttons reach into
the provider's pane from its leading edge: their width in a window with no sidebar and in the
sidebar pane they sit over, and `0` in the content pane beside a sidebar, which they do not reach.
It is `0` on every other OS but Linux. `titlebarTrailing` is the same measure from the trailing
edge: `0` on macOS, whose controls are on the leading side, and on every other OS but Linux. On
Linux, a window whose content runs under its header bar (`titleBar: 'transparent'` or `'hidden'`)
reports both, for the controls on each side of the desktop's `gtk-decoration-layout`, and `0` with
the default title bar, whose content sits below the bar.
When the provider that reported is destroyed, all four take what another provider still up last
reported, and with none they go back to where they started and the `--safe-area-inset-*` custom
properties go back to zero, so `Screen.window` follows `Dimensions` again until a provider reports.

Most layouts should not read `SafeArea` at all. A
[`<safe-area-view>`](/packages/components/safe-area) applies the insets natively, in the same layout
pass as everything else, without a round trip through JavaScript, and a screen in a native stack has
its header do it. Inject `SafeArea` for what neither covers: a floating button that must clear the
home indicator, a scroll view computing its own content inset, a sheet drawing its own chrome.

`report()` and `withdraw()` are called by `<safe-area-provider>`, not by an app. An inset written
from anywhere else is a number that stops matching the screen the moment the device rotates.

## Off a device and on the web

Off a device `insets` stays at all zeroes and `known()` stays `false` forever, because nothing ever
calls `report()` without a provider laid out somewhere. Guard behaviour that depends on `known()`
rather than assuming a provider is mounted above it.

## Reference

<!-- api: SafeArea -->
