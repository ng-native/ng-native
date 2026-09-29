---
title: Modal
summary: <modal>, presented over everything else, shown and hidden with [visible] or @if.
art: modal
---

# Modal

`<modal>` presents content over everything else, as `ModalHostView`.

```html
@if (showSettings()) {
<modal (requestClose)="showSettings.set(false)">
  <text>Settings</text>
</modal>
}
```

## Showing and hiding

`[visible]` (default `true`) shows and hides a modal that stays in the template:

```html
<modal [visible]="showSettings()" (requestClose)="showSettings.set(false)">
  <text>Settings</text>
</modal>
```

While `visible` is false the native host is not in the tree at all, as React Native's own `Modal`
renders nothing while hidden, so the screen underneath takes touches as usual. On iOS a modal that
was showing leaves once its dismissal has finished animating, which is also when `(dismiss)` fires;
on Android it leaves straight away. `@if` does the same for a modal whose content should not exist
while hidden, and destroys that content with it.

## Transparency

`transparent` (default `false`) shows through to the screen behind the modal, and the container
gets no backdrop; `backdropColor` sets the container's background otherwise, defaulting to white.
On iOS, a transparent modal presents as `presentationStyle="overFullScreen"` unless you set another,
since that is the only style that actually looks transparent - setting a different presentation
style while transparent logs a warning rather than failing silently. `presentationStyle` otherwise
chooses `'fullScreen'`, `'pageSheet'` or `'formSheet'` on iOS.

## Other props

`animationType` (`'none'`, `'slide'`, `'fade'`) controls how the modal appears and leaves.
`supportedOrientations` lists which orientations the modal may rotate to on iOS (defaults to
portrait), and `allowSwipeDismissal` lets a downward swipe dismiss it there, reported through
`(requestClose)`. On Android, `statusBarTranslucent` draws under the status bar,
`navigationBarTranslucent` draws under the navigation bar too (and needs `statusBarTranslucent` to
have any effect), and `hardwareAccelerated` gives the modal's window a hardware-accelerated
surface.

## Events

`(requestClose)` fires for the Android back button or an iOS swipe-to-dismiss. `(show)`,
`(dismiss)` and `(orientationChange)` are the others.

<!-- api: Modal -->
