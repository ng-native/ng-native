---
title: Sizing for the Mac
summary: The sizes a Mac app uses, and how to give a Mac its own with the macos variant.
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

The `macos:` and `desktop:` Tailwind variants, and the `platform-macos` class on the root, match on
a Mac only:

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
