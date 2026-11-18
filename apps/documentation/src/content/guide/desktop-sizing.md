---
title: Sizing for the Mac
summary: The sizes a Mac app uses, the macos variant that gives a Mac its own, and sizing for GNOME.
---

# Sizing for the Mac

Nothing rescales an app on macOS. A size in points is the same size in points on every OS: `rem`
is 16 points, text with no size is 14 points, and the system text size does not apply. A Mac uses
smaller type and denser rows than a phone, so an app gives the Mac its own sizes.

## The Mac's sizes

| What                      | Size        |
| ------------------------- | ----------- |
| Body text                 | 13 pt       |
| Captions and secondary    | 11 pt       |
| A list or sidebar row     | 22 to 28 pt |
| The least a target can be | 20 pt       |

## Giving the Mac its own

The `macos:` Tailwind variant and the `platform-macos` class on the root match on a Mac only, and
`desktop:` on a Mac and on Linux:

```html
<text class="text-base macos:text-[13px]">Inbox</text> <view class="h-11 macos:h-7">...</view>
```

```css
:host {
  padding: 16px;
}
:host-context(.platform-macos) {
  padding: 20px;
}
```

The native controls (`<native-button>`, `<switch>`, `<segmented-control>`, `<date-time-picker>`,
`<activity-indicator>`) are AppKit's own, measured at their `controlSize`: `mini`, `small`,
`regular` (the default) or `large`. Give them no width or height of your own.

The sidebar's rows, the toolbar and the menu bar are drawn by AppKit at the system's sizes.

## Sizing for GNOME

On Linux, `rem` is 16 points and text with no size is 14 points too, but text follows the desktop's
text scaling: GNOME's Large Text and its text scaling factor set `fontScale`, which text sizes are
multiplied by, as Dynamic Type's are on iOS. Layout sizes in points do not scale with it.

The `linux:` Tailwind variant and the `platform-linux` class match on Linux only, and `desktop:`
matches on macOS and Linux:

```html
<text class="text-base linux:text-[15px]">Inbox</text>
```

The native controls are GTK's and libadwaita's, measured as GTK lays them out at the desktop's own
sizes; `controlSize` does nothing there. Give them no width or height of your own. The header bar,
its buttons and the window controls are libadwaita's, at its sizes.
