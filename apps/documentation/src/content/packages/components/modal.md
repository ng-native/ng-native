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
while hidden, and destroys that content with it. Under `@ng-native/testing` the fake reports the
dismissal as iOS does, so a modal a test closes has left the tree once the interaction resolves.

## Transparency

`transparent` (default `false`) shows through to the screen behind the modal, and the container
gets no backdrop; `backdropColor` sets the container's background otherwise, defaulting to white.
On iOS, a transparent modal presents as `presentationStyle="overFullScreen"` unless you set another,
since that is the only style that actually looks transparent - setting a different presentation
style while transparent logs a warning rather than failing silently. `presentationStyle` otherwise
chooses `'fullScreen'`, `'pageSheet'` or `'formSheet'` on iOS.

## A popover at an element

`anchor` points the modal at an element: a template reference to an element, or to a component such
as a `<pressable>`. With one, the modal shows as a popover at that element on macOS and iPadOS, and
a click outside it closes it. On iPhone and Android the anchor is ignored and the modal presents as
it would without one.

```angular-html
<pressable #filter (press)="open.set(true)"><text>Filter</text></pressable>
<modal [anchor]="filter" [visible]="open()" (requestClose)="open.set(false)">
  <filter-options />
</modal>
```

## Other props

`animationType` (`'none'`, `'slide'`, `'fade'`) controls how the modal appears and leaves.
`supportedOrientations` lists which orientations the modal may rotate to on iOS (defaults to
portrait), and `allowSwipeDismissal` lets a downward swipe dismiss it there, reported through
`(requestClose)`. On Android, `statusBarTranslucent` draws under the status bar and
`navigationBarTranslucent` under the navigation bar, but under
[Android edge-to-edge](/guide/android-edge-to-edge) React Native turns both on whatever you set.
In an app that opts out of edge-to-edge, `navigationBarTranslucent` has an effect only with
`statusBarTranslucent`.
`hardwareAccelerated` gives the modal's window a hardware-accelerated surface.

## Safe area in a modal

On Android a modal is a window of its own, drawn under both the status bar and the navigation bar.
On iOS a full-screen modal reaches the notch and the home indicator. Either way it is outside the
app's view tree, so the root `<safe-area-provider>` does not reach it. Give its content a provider
of its own, with `[reportInsets]="false"` so the app-wide [`SafeArea`](/packages/device/safe-area)
keeps the app's insets, and a `<safe-area-view>` inside it:

```html
<modal (requestClose)="showSettings.set(false)">
  <safe-area-provider [reportInsets]="false" class="fill">
    <safe-area-view class="fill" [edges]="['top', 'bottom']">
      <text>Settings</text>
    </safe-area-view>
  </safe-area-provider>
</modal>
```

`.fill` is `flex: 1`. `SafeAreaProvider` and `SafeAreaView` come from `@ng-native/components`.

## Events

`(requestClose)` fires for the Android back button or an iOS swipe-to-dismiss. `(show)`,
`(dismiss)` and `(orientationChange)` are the others.

<!-- api: Modal -->
