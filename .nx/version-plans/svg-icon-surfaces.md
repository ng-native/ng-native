---
__default__: patch
---

On macOS and Linux, an icon's SVG markup, such as an `@ng-icons` icon, is the icon of a `<native-header-item>` bar button, a `<tray-icon>` and, on macOS, a `<menu-item>` or `<menu-group>` in any menu, and a desktop tab's row shows its `selectedIcon`.

`<native-header-item>` and `<tray-icon>` take a new `icon` input, a `ButtonIcon` as `<native-button>` takes it: `[icon]="{ svg: lucidePlus }"`, or `{ sfSymbol }`, which `systemImageName` or `sfSymbol` wins over. `<menu-item>` and `<menu-group>` take a `ButtonIcon` in `icon` too, where a string is still a drawable's name. Each commits the markup as `svgIcon`, and a header menu written as a `HeaderMenu` object takes `svgIcon` on an action or a submenu.

On macOS the host draws the markup as a template image AppKit tints, as it does an SF Symbol: on a toolbar button and its menu's items, on a menu item in the menu bar, a context menu, a press menu, the Dock menu and a tray icon's menu, and on a tray icon. On Linux a header bar button draws it in its text colour. A Linux tray icon and its menu items draw it as a picture, light on GNOME, whose top bar is dark, and elsewhere light in the dark style and dark in the light one. GTK draws no icon beside a menu item's label, so other Linux menus show none. iOS draws no SVG bar button icon, iOS and Android draw no SVG menu item icon, and in development the element says so once.

The desktop hosts draw a shape in `<defs>` or a `<symbol>` where a `<use>` draws it, so an icon set built from a shared symbol draws on macOS and Linux. One drawing expands at most 65,536 uses, so uses nested to double at each level stop rather than hang the window.

A desktop `<native-tab>` row shows the tab's `selectedIcon`, an SF Symbol on macOS or SVG markup on either, while the tab is the one shown.
