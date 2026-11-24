---
title: Native button
summary: <native-button>, the platform's own button on macOS and iOS, and a drawn one on Android.
---

# Native button

`<native-button>` is a button the platform draws: NSButton on macOS, a GtkButton on Linux and
UIButton on iOS. Android has no platform button, so there it is a view pressed as a
[`<pressable>`](/packages/components/pressable) is, and the web host draws an HTML `button`. Its
label is the text inside it.

```html
<native-button kind="default" (press)="save()">Save</native-button>
<native-button kind="cancel" (press)="close()">Cancel</native-button>
```

On iOS 26 and later it is a glass button, `default` the prominent one, and a filled or grey button
before. The iOS button is native code in `@ng-native/components`, so it draws in a development
build and not in Expo Go.

It is a button to a screen reader on every OS, and it takes focus. `[disabled]` stops presses and
greys it out.

## Inputs

- **`kind`** - `default`, `cancel`, `destructive` or `plain`. On macOS and Linux a `default` button
  takes Return and a `cancel` one takes Escape in its window. Unset, the button is a plain push
  button that takes neither key. While a one-line `<text-input>` has the focus, each OS keeps its
  own convention: on macOS Return still presses the `default` button, and on Linux the field keeps
  Return, as GTK's fields do, so it goes to `(submitEditing)` instead.
- **`controlSize`** - `mini`, `small`, `regular` or `large`: AppKit's control sizes on macOS, and
  UIKit's button sizes on iOS. Android and the web ignore it. `regular` when unset.
- **`sfSymbol`** - an SF Symbol before the label, on iOS and macOS.
- **`drawable`** - a drawable resource before the label, on Android, tinted in the label's colour.
  It is drawn through React Native's image view, which draws a bitmap drawable, a PNG or WebP, and
  nothing for a vector drawable written in XML.
- **`icon`** - either of the two as one value, `{ sfSymbol }` or `{ drawable }`, as on
  `<native-tab>`, or an icon's SVG markup, `{ svg }`, such as an `@ng-icons` icon:

  ```html
  <native-button [icon]="{ svg: lucidePlus }">Add</native-button>
  ```

  It is drawn before the label as a symbol is, in the label's colour. The macOS and Linux hosts
  draw the markup themselves: a template image AppKit tints on macOS, and in the button's text
  colour on Linux. They draw the shapes icon sets use, in one colour: paths, rectangles, circles,
  ellipses, lines, polylines and polygons, the groups around them, and a shape in `<defs>` or a
  `<symbol>` where a `<use>` draws it. They leave out text, clips and masks.

  iOS and Android draw it once as an image, through the renderer the app provides, as an SVG
  [tab icon](/packages/router/tabs) is: `withSvgIcons(SvgImages)` in `provideNativeRouter`, or
  `SVG_ICON_RENDERER` from `@ng-native/device` in an app without the router. Without one the button
  shows no icon, and in development it says so once. The button has no icon until it has been
  drawn, a frame or two after it appears. On iOS the image is a symbol's height in the title's
  font, and on Android it is 18 points square. The web shows no SVG icon.

`(press)` fires once for each click, tap or key that activates it. On Android it takes
`android_ripple` and the rest of a `<pressable>`'s press inputs.

## Control size elsewhere

`<switch>`, `<activity-indicator>`, and `<segmented-control>`, `<date-time-picker>` and
`<search-field>` from `@ng-native/expo` take `controlSize` too, with the same meaning.

## A look of your own

`<native-button>` looks like the platform's button and takes no styling beyond its size and
margins. For a button drawn from your own CSS, use a `<pressable>`.
