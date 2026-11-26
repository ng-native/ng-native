---
__default__: patch
---

On macOS and Linux, `<sidebar-item>`, `<native-button>` and a desktop `<native-tab>` take an icon's SVG markup, such as an `@ng-icons` icon, as their icon: `[icon]="{ svg: lucideBlocks }"`.

`ButtonIcon` has a third form, `{ svg: string }`, which the desktop host draws as its own icon: on macOS a template image AppKit tints for the selection, an inactive window and Increase Contrast, as it does an SF Symbol, and on Linux in the row's or the button's text colour. On macOS and Linux `<sidebar-item>` and `<native-button>` commit it as the `svgIcon` prop, and on macOS an `sfSymbol` set beside it wins.

A `<native-tab [icon]="{ svg }">` on macOS and Linux needs no `withSvgIcons` renderer, and commits its markup as a `data:image/svg+xml` icon source, which the host draws as the icon of the tab's sidebar row.

iOS, Android and the web draw no SVG button icon, and in development a `<native-button>` says so once. Either element also says once when its markup is no `<svg>` element, such as an icon's name given in its place.
