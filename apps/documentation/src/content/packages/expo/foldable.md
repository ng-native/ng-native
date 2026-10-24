---
title: Foldables
summary: The hinge of a foldable phone, its posture, angle and fold, as signals.
---

# Foldables

`Foldable` reads the hinge of a foldable device, an iPhone Duo or an Android foldable: how far it is
open, the angle, and where the fold crosses the app's window. A layout can then keep content off the
fold, or split into two panes either side of it.

## Install

```sh
npx expo install expo-foldables
```

On Expo SDK 58, install Expo's own `expo-hinge` as well:

```sh
npx expo install expo-hinge expo-foldables
```

```ts
import { Foldable } from '@ng-native/expo/foldable';
```

The posture and the angle come from `expo-hinge` when it is installed and reports a hinge, and from
`expo-foldables` otherwise. `expo-hinge` does not say where the fold crosses the window, so `fold`,
`separating`, `book` and `tabletop` come from `expo-foldables` only; with `expo-hinge` alone they
are null or false. `expo-hinge` reports a hinge on Android 11 or newer, and on iOS 27.1 or newer in
an app built with the iOS 27.1 SDK. On Android it never reports `'closed'`: a closed device has an
`angle` near `0`, and while the window does not span the fold the posture comes from
`expo-foldables`, which reads a closed device from its angle.

On iOS both need Xcode 27.1 or newer, for the iPhone Duo's `UIHinge`. Expo Go can't load them, so
use a development build.

## Two panes either side of the fold

```ts
import { Component, computed, inject } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Foldable } from '@ng-native/expo/foldable';

@Component({
  selector: 'app-reader',
  imports: [Text, View],
  template: `
    @if (split(); as fold) {
      <view class="row">
        <view [style.width.px]="fold.bounds.x"><text>Contents</text></view>
        <view [style.width.px]="fold.bounds.width"></view>
        <view class="pane"><text>Chapter</text></view>
      </view>
    } @else {
      <text>Chapter</text>
    }
  `,
  styles: `
    .row {
      flex: 1;
      flex-direction: row;
    }
    .pane {
      flex: 1;
    }
  `,
})
export class Reader {
  private readonly foldable = inject(Foldable);
  protected readonly split = computed(() => {
    const fold = this.foldable.fold();
    return this.foldable.separating() && fold?.orientation === 'vertical' ? fold : null;
  });
}
```

`fold().bounds` is in window coordinates, so `bounds.x` is the width of the left pane only for a
layout that starts at the window's left edge, as an app's root view does. Inside padding, beside a
side panel, or in a window that does not start at the screen's edge, subtract the layout's own
offset from `bounds.x`.

## What it reports

- **`available`** - whether the device reports a hinge. It can turn true shortly after launch, once
  the platform first reports one.
- **`posture`** - `'closed'`, `'partially-open'`, `'fully-open'`, or `'unknown'` without a hinge.
- **`fold`** - where the fold crosses the window: `bounds` in points, `orientation`, `isSeparating`
  and `occlusion`. Null when it crosses no window, as on a closed phone's cover display.
- **`angle`** - the hinge angle in degrees, `0` shut and `180` flat. Null without a hinge or an
  angle sensor, and until the first reading.
- **`separating`** - whether the fold splits the window, so content should stay off it.
- **`book`** and **`tabletop`** - half open with the fold running down the middle, or across it.

Everything is a signal, so a template or a `computed()` follows the device as it folds.

## Without a hinge

On a phone that does not fold, on the web and in a test, `Foldable` answers like a phone: not
available, `'unknown'`, no fold and no angle. On iOS and Android with neither `expo-hinge` nor
`expo-foldables` installed, injecting it does not throw; a call, or a read of a value only the
module knows, throws an error that says what to install.

## Testing

`Foldable.SOURCE` stands in for `expo-foldables`, and `Foldable.HINGE` for `expo-hinge`:

```ts
{ provide: Foldable.SOURCE, useValue: fakeFoldables },
{ provide: Foldable.HINGE, useValue: { getHinge: () => hinge, addHingeListener: (listener) => subscription } },
```
