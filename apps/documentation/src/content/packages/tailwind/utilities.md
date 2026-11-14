---
title: Safe area and hairlines
summary: Utility classes for safe-area insets and the thinnest line a screen can show.
---

# Safe area and hairlines

These two utility families exist because Tailwind has no reason to ship them on its own: neither
concept means anything to a browser stylesheet.

## Safe-area utilities

`pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, `p-safe`, `px-safe` and `py-safe` read the safe-area
insets as custom properties, so they update on rotation with no rebuild. `mt-safe`, `mr-safe`,
`mb-safe` and `ml-safe` do the same for margin, for a value that needs to push a sibling out of the
inset rather than pad its own content into it.

```html
<view class="pt-safe px-4" style="flex: 1">...</view>
```

`pt-safe-4` adds the inset to a step off the spacing scale - the padding a design wanted under the
status bar or notch anyway. `min-pt-safe-4` takes whichever of the inset and the step is larger, for
a layout that already had padding and only needs it to grow where the device needs more:

```html
<view class="min-pt-safe-4">...</view>
```

On native the insets arrive at runtime from `<safe-area-provider>`; on the web they come from
`env(safe-area-inset-*)`.

## Hairline utilities

`h-hairline`, `w-hairline`, `border-hairline` and the per-side `border-{t,r,b,l}-hairline` draw the
thinnest line the screen can actually show - a third of a point on a 3x display - rather than
Tailwind's `border`, which is one full CSS pixel and reads as a visibly fat divider on a phone.

```html
<view class="border-t-hairline border-gray-200"></view>
```

The width comes from `deviceTokens()` on native, and `watchConditions()` updates it when a window
moves to a screen of another pixel ratio, such as a Mac window dragged to a second display. On the
web it comes from a `min-resolution` media query. Reach for `border-hairline` any time a design
calls for "the thinnest line the platform can draw" rather than a fixed point size.
