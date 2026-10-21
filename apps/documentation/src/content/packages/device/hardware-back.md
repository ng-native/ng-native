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

This is not a signal, because a press is a question rather than a state: the platform asks whether
anybody wants it, and the answer decides what happens next. `handle(handler)` returns an
unsubscribe. React Native runs the most recently added handler first, so a screen that subscribes on
mount outranks the one below it.

`@ng-native/router`'s outlets already call this: the back button pops the stack in front, and at
the root of a tab goes to the first tab (see [Tabs](/packages/router/tabs)). An app's own overlay
layer is the other typical caller, to close the topmost dialog or sheet
instead of backgrounding the app. Most apps never touch `HardwareBack` directly; it exists for the
screen that wants to intercept the button itself, to confirm leaving a form with unsaved changes,
for instance.

## Off a device and on the web

Off a device and on iOS, `handle()` still returns an unsubscribe but nothing ever calls the handler,
because there is no hardware back button on either. On the web there is no equivalent hardware
button either; a browser's own back gesture is not the same event.

## Reference

<!-- api: HardwareBack -->
