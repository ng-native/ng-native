---
title: Vibration
summary: The phone's motor - for an alarm, a timer or an incoming call, not for button feedback.
---

# Vibration

`Vibration` is the phone's motor, not the Taptic Engine - use this for an alarm, a timer or an
incoming call, not for button feedback (that is haptics, in `@ng-native/expo`).

```ts
import { Component, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { Vibration } from '@ng-native/device';

@Component({ selector: 'app-timer', imports: [View], template: `<view />` })
export class Timer {
  private readonly vibration = inject(Vibration);

  protected onTimerDone(): void {
    this.vibration.pattern([0, 500, 200, 500], { repeat: true });
  }

  protected dismiss(): void {
    this.vibration.stop();
  }
}
```

`buzz(durationMs?)` is a single buzz, 400ms by default. `pattern(millis, options?)` is a pattern of
waits and buzzes in milliseconds, starting with a wait; `repeat: true` runs it until `stop()`, which
is for something that must be answered - an alarm, a call - and is a promise to call `stop()` rather
than a decoration. `stop()` cancels whatever is running.

iOS has one duration and ignores the number, so a pattern there is on and off at a fixed strength;
Android takes the milliseconds as written. Both are said plainly rather than papered over, because a
pattern designed on Android does not feel the same on iOS and nothing here can make it.

## Off a device

Off a device every method does nothing, because there is no `Vibration` module underneath it.

## Reference

<!-- api: Vibration -->
