---
title: Hardware back
summary: Claiming Android's hardware back button, and letting the platform decide when nobody does.
---

# Hardware back

`HardwareBack` lets a component claim Android's hardware back button. A handler returns whether it
consumed the press; returning `false` lets the platform do what it would have done, which at the
bottom of a navigation stack means backgrounding the app rather than the press silently doing
nothing - so a user who backs out of the first screen finds the app where they left it rather than
watching it close.

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { HardwareBack } from '@ng-native/device';

@Component({ selector: 'app-unsaved-form', imports: [View], template: `<view />` })
export class UnsavedForm {
  private dirty = false;

  constructor() {
    const stop = inject(HardwareBack).handle(() => {
      if (!this.dirty) return false;
      this.confirmDiscard();
      return true;
    });
    inject(DestroyRef).onDestroy(stop);
  }

  private confirmDiscard(): void {}
}
```

The handler is asked for Android's Back button only. That suits a form on the first screen of a
stack, where Back has nothing to pop and goes past the stack: to the first tab, or out of the app.
A screen pushed onto a stack or presented over it has other ways out that never ask `HardwareBack`:
the header's back arrow on Android, and the swipe back or down on iOS. For a form there, bind
`preventNativeDismiss` on the page instead, as
[Refusing a dismissal](/packages/router/screens#refusing-a-dismissal) shows. The screen then refuses
the Back button, the arrow and the swipe alike, and the page hears each one as
`(nativeDismissCancelled)`.

This is not a signal, because a press is a question rather than a state: the platform asks whether
anybody wants it, and the answer decides what happens next. `handle(handler)` returns an
unsubscribe. React Native runs the most recently added handler first, so a screen that subscribes on
mount outranks the one below it.

A handler subscribed in a screen's injection context, as from its constructor above, is asked only
while that screen is in front (see `SCREEN_IN_FRONT`). While another screen is pushed over it,
presented over it as a sheet or a modal, or its tab is not the selected one, the press goes past it
to whatever is in front, so the form above does not stop a back on a screen it opened. It is asked
again once its screen is back in front. A handler subscribed outside an injection context, or where
no screen is provided, such as an app's root component or a service, is asked whatever is showing.

`@ng-native/router`'s outlets already call this: the back button pops the stack in front, and at
the root of a tab goes to the first tab (see [Tabs](/packages/router/tabs)). An app's own overlay
layer is the other typical caller, to close the topmost dialog or sheet
instead of backgrounding the app. Most apps never touch `HardwareBack` directly; it exists for the
screen that wants to intercept the button itself, such as a form on the first screen of a stack.

## Off a device and on the web

Off a device and on iOS, `handle()` still returns an unsubscribe but nothing ever calls the handler,
because there is no hardware back button on either. On the web there is no equivalent hardware
button either; a browser's own back gesture is not the same event.

## Reference

<!-- api: HardwareBack -->
