---
title: Activity indicator
summary: <activity-indicator>, a native spinner, and why it needs an explicit size.
art: activity-indicator
---

# Activity indicator

`<activity-indicator>` is a spinner: `ActivityIndicatorView` on iOS, `AndroidProgressBar` on
Android.

```html
<activity-indicator size="large" color="#3a82f6" [animating]="loading()" />
```

`size` is `'small'` (the default, matching React Native's 20 points), `'large'` (36 points), or a
number to set both dimensions at once. `animating` (default `true`) starts and stops it, and
`hidesWhenStopped` (iOS) hides the spinner entirely rather than leaving a still one on screen while
stopped.

## Why it carries an explicit size

The native view has no intrinsic dimensions of its own: without a size, it stretches to fill
whatever space its parent offers. That failure is invisible in the obvious way, because the
spinner still draws at its natural size in the middle of the stretched box - but the box swallows
gestures across its whole width, so a tap that should have landed on something else next to it
does not. `<activity-indicator>` always sends an explicit width and height so this never happens.

## On Android

Android's `AndroidProgressBar` has no default drawable and throws out of its own update pass if
the first commit arrives without one, taking the whole screen down with it - so `styleAttr`
(`'Normal'`, for every size, matching what React Native's own wrapper sends) and `indeterminate`
(`true`) are always sent on Android. Neither reaches iOS, where `ActivityIndicatorView` has no
equivalent props.

## Reference

<!-- api: ActivityIndicator -->
