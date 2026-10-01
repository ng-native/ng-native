---
title: Foldables
summary: The hinge of a foldable phone, its posture, angle and fold, as signals.
---

# Foldables

`Foldable` reads the hinge of a foldable device, an iPhone Duo or an Android foldable, through
`expo-foldables`: how far it is open, the angle, and where the fold crosses the app's window. A
layout can then keep content off the fold, or split into two panes either side of it.

## Install

```sh
npx expo install expo-foldables
```

```ts
import { Foldable } from '@ng-native/expo/foldable';
```

On iOS it needs Xcode 27.1 or newer, for the iPhone Duo's `UIHinge`. Expo Go can't load it, so use
a development build.

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
  protected readonly split = computed(() =>
    this.foldable.separating() && this.foldable.fold()?.orientation === 'vertical'
      ? this.foldable.fold()
      : null,
  );
}
```

## What it reports

- **`available`** - whether the device reports a hinge. It can turn true shortly after launch, once
  the platform first reports one.
- **`posture`** - `'closed'`, `'partially-open'`, `'fully-open'`, or `'unknown'` without a hinge.
- **`fold`** - where the fold crosses the window: `bounds` in points, `orientation`, `isSeparating`
  and `occlusion`. Null when it crosses no window, as on a closed phone's cover display.
- **`angle`** - the hinge angle in degrees, `0` shut and `180` flat. Null without an angle sensor,
  and until the first reading.
- **`separating`** - whether the fold splits the window, so content should stay off it.
- **`book`** and **`tabletop`** - half open with the fold running down the middle, or across it.

Everything is a signal, so a template or a `computed()` follows the device as it folds.

## Without a hinge

On a phone that does not fold, on the web and in a test, `Foldable` answers like a phone: not
available, `'unknown'`, no fold and no angle. On iOS and Android without `expo-foldables`
installed, injecting it throws an error that says what to install.

## Testing

`Foldable.SOURCE` stands in for the hinge:

```ts
{ provide: Foldable.SOURCE, useValue: fakeHinge }
```
