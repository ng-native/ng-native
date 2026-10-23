---
title: App state
summary: Whether the app is in front of the user, for anything that should stop when it is not.
---

# App state

`AppState` reports whether the app is in front of the user: `active`, `background`, or (iOS only)
the transitional `inactive` - the app switcher open, a call coming in, the notification shade pulled
down.

```ts
import { Component, effect, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { AppState } from '@ng-native/device';

@Component({ selector: 'app-video-player', imports: [View], template: `<view />` })
export class VideoPlayer {
  private readonly appState = inject(AppState);

  constructor() {
    effect(() => {
      if (!this.appState.active()) this.pause();
    });
  }

  private pause(): void {}
}
```

Anything that should stop when nobody is looking - a poll, a video, a timer - wants `active()`, not
the mere absence of `background`, which is why that is the boolean this exposes rather than one for
`background` itself: an app in the transitional `inactive` state is not in the background, but it is
not in front of the user either.

## Off a device and on the web

Off a device `current` reports `active` and never changes, because there is no `AppState` module
underneath it to ask - the same as an app that is always in front of somebody. There is a rough web
equivalent in the page visibility API, but `AppState` does not read it; a web build should use
`document.visibilityState` directly for the same decision.

## Reference

<!-- api: AppState -->
