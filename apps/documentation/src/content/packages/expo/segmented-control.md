---
title: Segmented control
summary: The platform's segmented control as a typed component, with the segment picked in an event.
---

# Segmented control

`<segmented-control>` is the native segmented control, typed for strict templates: UIKit's
`UISegmentedControl` on iOS, and AppKit's on the desktop host with no library installed. It is iOS
and macOS only.

## Install

On iOS it needs `@react-native-segmented-control/segmented-control`:

```sh
npx expo install @react-native-segmented-control/segmented-control
```

## The smallest useful example

```ts
import { Component, signal } from '@angular/core';
import { SegmentedControl } from '@ng-native/expo/segmented-control';

@Component({
  selector: 'app-sort-order',
  imports: [SegmentedControl],
  template: `
    <segmented-control
      [values]="orders"
      [selectedIndex]="selected()"
      (change)="selected.set($event.nativeEvent.selectedSegmentIndex)"
    />
  `,
})
export class SortOrder {
  protected readonly orders = ['Newest', 'Oldest', 'Name'];
  protected readonly selected = signal(0);
}
```

The component is also exported from `@ng-native/expo`. It registers the element the first time one
is made, so no `registerNativeViews` call is needed. Bind `(change)`: the library only installs its
native handler when the event is bound.

## Inputs and events

- **`values`** - the segments' titles.
- **`selectedIndex`** - the segment shown selected.
- **`momentary`** - segments do not stay selected; each is a button.
- **`enabled`** - `false` refuses input.
- **`tintColor`** and **`backgroundColor`** - the selected segment's colour, and the control's.
- **`fontStyle`** and **`activeFontStyle`** - the font of the titles, and of the selected one:
  `color`, `fontSize`, `fontFamily` and `fontWeight`.
- **`apportionsSegmentWidthsByContent`** - each segment as wide as its title, not all equal.
- **`controlSize`** - `'mini'`, `'small'`, `'regular'` or `'large'`: AppKit's control size on macOS,
  and UIKit's on iOS 26 and later.
- **`accessibilityLabel`** - what a screen reader announces for the control.
- **`change`** - the user picked a segment. `$event.nativeEvent` holds `value`, the title, and
  `selectedSegmentIndex`.

The [native views](/packages/expo/native-views) page covers the other community views.

## Reference

<!-- api: SegmentedControl -->
