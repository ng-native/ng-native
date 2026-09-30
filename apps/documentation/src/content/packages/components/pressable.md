---
title: Pressable
summary: <pressable>, <touchable-opacity>, and the touch responder negotiation behind them.
art: pressable
---

# Pressable

Touches are not delivered as raw taps. React Native negotiates a _responder_: when a finger goes
down, every view under it is asked in turn, from the outside in, whether it wants to claim the
touch, and then again from the inside out whether it will actually take it. That negotiation is
what lets a button inside a scroll view work correctly - the scroll view can claim a drag that
moves too far, and a nested pressable wins the touch over its container when both would otherwise
claim it. This package builds `press`, `pressIn`, `pressOut` and `longPress` on top of that same
negotiation, the way React Native's own `Pressability` does, rather than on plain touch listeners
that could not express any of it.

A touch held for `delayLongPress` fires `longPress` instead of `press`, but only when something
listens to `(longPress)`. Without a listener there is no long press, so a slow tap is still a
`press`, as in React Native.

On Android, a keyboard's Enter or D-pad centre and TalkBack's double-tap activate the focused
control with a click rather than a touch. That fires `press` alone, with no `pressIn` or
`pressOut`, and only on the control that has focus, as React Native's `Pressability` does.

## Pressable

`<pressable>` is the bare version of this: it renders a view and nothing else, but adds the press
machinery. `pressed` is a public signal, reachable through a template reference for styling that
depends on the press state without needing a class:

```html
<pressable #p="pressable" [style.opacity]="p.pressed() ? 0.6 : 1" (press)="onTap()">
  <text>Tap me</text>
</pressable>
```

`<touchable-opacity>` is the same machinery wired to React Native's own default look: it fades to
`activeOpacity` while pressed and eases back, using a CSS transition rather than a per-frame
tween, with React Native's own asymmetric timings (150ms in, 250ms out).

## Props

Every pressable exposes `disabled`, `hitSlop`, `pressRetentionOffset` (how far a finger may wander
before the press is canceled - separate from `hitSlop`, which is how far outside the view a touch
may _start_), `delayLongPress`, `delayPressIn`, `delayPressOut`, `minPressDuration` (the pressed
look is held at least this long even on the quickest tap), `cancelable` (whether a scrolling
ancestor may take the gesture away mid-press) and, on Android, `androidRipple` for a native
ripple.

`disabled` stops the presses. Whether `aria-disabled` and `accessibilityState.disabled` stop them
too depends on the component, as in React Native: on a `<touchable-opacity>` they do when
`disabled` is unset, as on `TouchableOpacity`, and on a `<pressable>` or a `PressBehavior` host they
only change what VoiceOver and TalkBack announce, as on `Pressable`.

## Nested pressables

A pressable inside a pressable - a row with a delete button in it - needs nothing extra. The
negotiation elects the innermost pressable that wants the touch, so a tap on the button presses
the button and never the row. What does bubble past the button is the plain touch events,
`(touchStart)` and `(touchEnd)`, which are not negotiated; a handler that wants an ancestor not to
see one calls `$event.stopPropagation()`.

## Composing pressability onto a component

A component that wants to _be_ pressable rather than _contain_ something pressable - a custom
button, say - composes `PressBehavior` through `hostDirectives` instead of wrapping a
`<pressable>`. That puts the whole responder negotiation on the component's own host node at the
cost of one native view rather than two, and the component calls `contributeAccessibility` to tell
the view primitive on that same host what role and state it should announce.

A component that reacts to its own press, such as a checkbox toggling itself, forwards `press` in
its `hostDirectives` entry and listens for it in `host`:

```ts
import { Component, signal } from '@angular/core';
import { PressBehavior } from '@ng-native/components';

@Component({
  selector: 'ui-checkbox',
  template: '<ng-content />',
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
  host: { '(press)': 'toggle()' },
})
export class Checkbox {
  readonly checked = signal(false);

  toggle(): void {
    this.checked.update((checked) => !checked);
  }
}
```

The forwarding is Angular's rule rather than this package's: a host listener hears only the
outputs the host exposes. Without `outputs: ['press']` the `(press)` listener never runs, and
nothing reports it. Forwarded, `press` also reaches a `(press)` the app binds on `<ui-checkbox>`.
A component that keeps `press` to itself can subscribe to the behavior instead, which needs
nothing forwarded: `inject(PressBehavior).press.subscribe(() => this.toggle())` in the
constructor.

<!-- api: Pressable -->

<!-- api: TouchableOpacity -->
