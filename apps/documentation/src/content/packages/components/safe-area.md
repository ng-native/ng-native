---
title: Safe area
summary: Keep content clear of the notch, status bar and home indicator with safe-area-provider and safe-area-view.
art: safe-area
---

# Safe area

The safe area is the part of the screen nothing else draws over: inside the status bar, the notch
or Dynamic Island, the home indicator, and on Android the navigation bar. Two components keep
content inside it: `<safe-area-provider>` measures it once at the root, and `<safe-area-view>`
insets its content by it. The numbers themselves, for code that needs them, come from the
[`SafeArea`](/packages/device/safe-area) service in `@ng-native/device`.

`<safe-area-provider>` measures the safe area once, at the root of the app, and reports it; every
`<safe-area-view>` in the tree depends on one being above it. This dependency is easy to miss
because a missing provider does not fail loudly: a `<safe-area-view>` walks up looking for a
provider exactly once, as it first enters the window and before it has been laid out, and falls
back to reading its own insets if it does not find one - which reads as zero insets and looks
indistinguishable from "it is working, there is just nothing to inset here" until the app is run
on a device with a notch or a home indicator. On iOS it reads them again only when a later update
reaches that view, such as an appearance change, so the content can jump into place well after
launch.

```html
<safe-area-provider>
  <native-stack-outlet />
</safe-area-provider>
```

A screen presented outside the normal navigation tree - a modal - needs its own
`<safe-area-provider>`, because it sits outside the stack's own view hierarchy. Give it
`[reportInsets]="false"` so its own measurements do not overwrite the app-wide safe area while it
is on screen.

`<safe-area-view>` applies the insets as padding (or, with `mode="margin"`, as margin) natively,
in the same layout pass as everything else, so there is no frame where content sits under the
notch before moving clear of it. `edges` chooses which sides matter - a screen already under a
native header usually only wants `[edges]="['bottom']"` - and defaults to insetting all four when
left unset. A per-edge object lets one edge take the larger of its own padding or the inset
(`'maximum'`), add to it (`'additive'`, the default for a listed edge), or ignore it (`'off'`).

```html
<safe-area-view [edges]="['bottom']" class="flex-1">
  <text>Content that should not sit under the home indicator</text>
</safe-area-view>
```

Inside a tab, the provider's insets stop short of the tab bar: it measures the window from the
root, above the bar, so a `<safe-area-view>` there clears the home indicator and nothing more.
Content pinned to the bottom of a tab uses `<tab-safe-area-view>` from `@ng-native/router`, which
asks the tab screen what the bar covers - see
[Content above the tab bar](/packages/router/tabs#content-above-the-tab-bar). The custom
properties below have the same limit.

The same insets are also published as CSS custom properties - `--safe-area-inset-top`, `-right`,
`-bottom` and `-left` - so a stylesheet can reach for them directly, the native equivalent of
`env(safe-area-inset-bottom)` on the web:

```css
.floating-button {
  margin-bottom: var(--safe-area-inset-bottom, 0px);
}
```

`env(safe-area-inset-bottom)` and the other three sides compile to the same custom properties, so a
stylesheet shared with the web can keep its `env()`.

Both components need `react-native-safe-area-context` installed; without it they render as
unimplemented views rather than doing nothing quietly.

## Reference

<!-- api: SafeAreaProvider -->
<!-- api: SafeAreaView -->
