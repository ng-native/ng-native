---
title: Native button
summary: <native-button>, the platform's own button on macOS and iOS, and a drawn one on Android.
---

# Native button

`<native-button>` is a button the platform draws: NSButton on macOS and UIButton on iOS. Android
has no platform button, so there it is a view pressed as a
[`<pressable>`](/packages/components/pressable) is, and the web host draws an HTML `button`. Its
label is the text inside it.

```html
<native-button kind="default" (press)="save()">Save</native-button>
<native-button kind="cancel" (press)="close()">Cancel</native-button>
```

It is a button to a screen reader on every OS, and it takes focus. `[disabled]` stops presses and
greys it out.

## Inputs

- **`kind`** - `default`, `cancel`, `destructive` or `plain`. On macOS a `default` button takes
  Return and a `cancel` one takes Escape in its window. Unset, the button is a plain push button
  that takes neither key.
- **`controlSize`** - `mini`, `small`, `regular` or `large`: AppKit's control sizes on macOS, and
  UIKit's on iOS 26 and later. Android and the web ignore it. `regular` when unset.
- **`sfSymbol`** - an SF Symbol beside the label, on iOS and macOS.
- **`drawable`** - a drawable resource beside the label, on Android.
- **`icon`** - either of the two as one value, `{ sfSymbol }` or `{ drawable }`, as on
  `<native-tab>`.

`(press)` fires once for each click, tap or key that activates it. On Android it takes
`android_ripple` and the rest of a `<pressable>`'s press inputs.

## Control size elsewhere

`<switch>`, `<activity-indicator>`, and `<segmented-control>`, `<date-time-picker>` and
`<search-field>` from `@ng-native/expo` take `controlSize` too, with the same meaning.

## A look of your own

`<native-button>` looks like the platform's button and takes no styling beyond its size and
margins. For a button drawn from your own CSS, use a `<pressable>`.
