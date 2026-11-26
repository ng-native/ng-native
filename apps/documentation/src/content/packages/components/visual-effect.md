---
title: Visual effect
summary: A view in one of macOS's translucent materials, with the desktop showing through it.
---

# Visual effect

`<visual-effect>` draws one of the system's materials behind its children. On macOS it is an
`NSVisualEffectView`: with its default `behind-window` blending, what is behind the window shows
through it, blurred and tinted, as it does through a source list's sidebar. A window can have that
look without a `<split-view>`, round a layout of its own:

```html
<visual-effect class="window" material="sidebar">
  <view class="sidebar">...</view>
  <view class="card">...</view>
</visual-effect>
```

```css
.window {
  flex: 1;
  flex-direction: row;
  background-color: #f3f2f2;
}
.card {
  flex: 1;
  margin: 8px;
  border-radius: 10px;
  background-color: #ffffff;
}
```

Import `VisualEffect` from `@ng-native/components`. It lays out and takes styles as a `<view>` does,
and its `border-radius` rounds the material. Content in it draws over the material, so a card with
a background of its own stays opaque.

On Linux, iOS and Android it is a plain view, and none of the material's props reach native: give
it a `background-color`, as above, for those, which macOS draws under the material.

<!-- os-support -->

## Inputs

- **`material`**: one of AppKit's materials, by the name of its `NSVisualEffectMaterial` case:
  `sidebar` (the default), `window-background`, `under-window-background`, `content-background`,
  `under-page-background`, `header-view`, `titlebar`, `menu`, `popover`, `sheet`, `hud-window`,
  `full-screen-ui`, `tooltip` or `selection`. A name it does not know draws `sidebar`.
- **`blendingMode`**: `behind-window` (the default) blurs the desktop and the windows behind the
  window; `within-window` blurs the window's own content under the view.
- **`state`**: `follows-window` (the default) looks active while the window is key and inactive
  otherwise, as a sidebar does; `active` and `inactive` keep one look.
- **`emphasized`**: draws the `selection` material in the accent colour, as a source list's focused
  selection is.

A behind-window material shows the desktop only where nothing opaque is above it in the window, so
leave the root and the views between it and the `<visual-effect>` without a background of their
own on macOS.

<!-- api: VisualEffect -->
