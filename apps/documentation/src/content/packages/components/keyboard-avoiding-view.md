---
title: Keyboard-avoiding view
summary: <keyboard-avoiding-view> moves its content clear of the on-screen keyboard.
art: keyboard-avoiding-view
---

# Keyboard-avoiding view

`<keyboard-avoiding-view>` moves its content clear of the keyboard, by padding
(`behavior="padding"`, the default here), shrinking (`"height"`) or shifting (`"position"`).

```html
<keyboard-avoiding-view class="flex-1">
  <text-input placeholder="Message" [formField]="message" />
</keyboard-avoiding-view>
```

There is no native component behind this on either platform. It measures its own frame against
the keyboard's reported height and adjusts a style, which is also why it does nothing useful off a
device with no keyboard to avoid.

## How the overlap is measured

The overlap is the view's own frame against the keyboard's top edge, so a view that does not reach
the bottom of the screen moves only as far as it must. The frame is measured in the window, which
is what the keyboard reports its position in, so a view on a screen under a navigation bar needs no
allowance for the bar. React Native measures in the parent's coordinates instead, and there a
header's height has to go in `keyboardVerticalOffset`; here it would be counted twice. Use
`keyboardVerticalOffset` only for extra room you want left above the keyboard.

The overlap never exceeds the view's own height, so a view the keyboard covers entirely is padded
or shrunk to nothing rather than past it.

A body that should shrink and a bar that should sit on the keyboard both go inside:

```html
<keyboard-avoiding-view class="flex-1">
  <scroll-view class="flex-1"><!-- the body --></scroll-view>
  <view class="flex-row px-5 py-2"><text>{{ wordCount() }} words</text></view>
</keyboard-avoiding-view>
```

## A bar that rides the keyboard

A composer, a comment box or a row of formatting keys that should sit on the keyboard belongs in a
`<keyboard-dock>` rather than at the bottom of a `<keyboard-avoiding-view>`. While a finger drags
the keyboard down to dismiss it (`keyboardDismissMode="interactive"`), iOS reports no frame
changes until the finger lets go, so anything moved by keyboard events - this view included -
stays where it was and a gap opens under it.

On iOS, with [react-native-keyboard-controller](https://kirillzyusko.github.io/react-native-keyboard-controller/)
installed and `provideKeyboardController()` in the app's providers, the dock's bar is moved by the
keyboard's height on the native side, every frame: as the keyboard rises and falls, and through an
interactive dismissal. The drag takes the keyboard from the top of the bar, as Messages does, and
a short drag springs it back. `[keyboardLift]` moves the content above with it:

```ts
import { provideKeyboardController } from '@ng-native/components';

export const appConfig = { providers: [provideKeyboardController() /* ... */] };
```

```html
<view class="flex-1">
  <view class="flex-1 overflow-hidden">
    <view class="flex-1" [keyboardLift]="dock">
      <virtual-list
        class="flex-1"
        [inverted]="true"
        keyboardDismissMode="interactive"
        [items]="messages()"
      >
        <!-- rows -->
      </virtual-list>
    </view>
  </view>
  <keyboard-dock #dock backgroundColor="#f4f4f7">
    <view class="flex-row p-2"><text-input class="flex-1" [multiline]="true" /></view>
  </keyboard-dock>
</view>
```

The lifted view sits inside one that clips, so what rises past its top is hidden rather than
drawn over the screen above it. Without the library, and on Android, the dock sits in flow,
padded by as much of the keyboard as covers it, which it learns as the keyboard starts to move.

`covered()` is how much of the bottom of the screen the keyboard covers beyond the dock's own
place, for content that keeps clear of it with padding or an inset rather than moving with it. It
is updated once the keyboard has moved. `backgroundColor` fills the bar and the inset under it.

While another screen is pushed over the dock's own or presented from it, the dock lets the keyboard
go.

<!-- api: KeyboardDock -->

## Your own style

Style the view as you would any other, with `class` or `[style]`. While the keyboard is up, the
adjustment has the last word on the properties it moves, as it does in React Native: `paddingBottom`
in `padding` mode, `height` and `flex: 0` in `height` mode, and the inner view's `bottom` in
`position` mode. So `[style]="{flex: 1}"` still shrinks in `height` mode, and every other property
you wrote applies throughout. When the keyboard goes, your own values come back.

`enabled` (default `true`) stops avoiding without removing the view. With `behavior="position"`,
`contentContainerStyle` styles the inner view that gets shifted, and `contentContainerClass` gives
it classes, matched as if the view were written in your own template, as on
[`<scroll-view>`](/packages/components/scroll-view).

## Animation

The adjustment itself animates with the keyboard's own motion, the way React Native's own
`KeyboardAvoidingView` does: a keyboard event's `duration` and `easing` configure the next layout
animation before the style change that moves this view, so the two run together rather than the
padding, height or position jumping to its resting place in one step.

<!-- api: KeyboardAvoidingView -->
