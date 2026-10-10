---
title: Ongoing notifications
summary: Show what's happening now in an Android notification that stays, from a signal.
---

# Ongoing notifications

`ongoingNotification()` keeps an Android notification in step with a signal: start it, and every
change to the signal replaces what it shows, silently, until you end it. It is Android's
counterpart to a [Live Activity](/packages/expo/live-activity), and it asks Android to show it as
a Live Update, with a chip in the status bar, where Android has them.

It comes with `@ng-native/expo`, whose native half draws it, so it needs an app built since
`@ng-native/expo` was installed: `npx expo run:android`, or a new EAS build.

```ts
import { ongoingNotification } from '@ng-native/expo/ongoing-notification';
```

## Keep it in step from Angular

Android draws the notification from data, not from a layout, so there is no template to compile:
the signal holds what it shows.

```ts
import { Component, computed, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { ongoingNotification } from '@ng-native/expo/ongoing-notification';
import { Match } from './match.ts';

@Component({
  selector: 'app-scoreboard',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="status.active() ? status.end() : status.start()">
      <text>{{ status.active() ? 'Stop showing the score' : 'Show in notifications' }}</text>
    </pressable>
  `,
})
export class Scoreboard {
  private readonly match = inject(Match);
  protected readonly status = ongoingNotification(
    computed(() => ({
      title: `Us ${this.match.us()} - ${this.match.them()} Them`,
      text: `Set ${this.match.set()}`,
      timer: { since: this.match.startedAt() },
      chip: `${this.match.us()}-${this.match.them()}`,
      actions: [
        { target: 'us', title: 'Point us' },
        { target: 'them', title: 'Point them' },
      ],
    })),
    {
      channel: { id: 'match', name: 'Match score' },
      url: 'padel://match',
      onTaps: (taps) => taps.forEach((side) => this.match.point(side)),
    },
  );
}
```

Call it in an injection context, such as a field of a component or service.

## What it shows

- **`title`** and **`text`**.
- **`timer`** is time Android counts by itself, with no update from the app: up from `since`, or
  down to `until`. Each is a `Date` or milliseconds since the epoch.
- **`progress`** is a bar filled to `value` of `max`, 100 unless given, or a moving bar with
  `{ indeterminate: true }`.
- **`chip`** is the text of the status bar chip of a Live Update: keep it under seven characters,
  which is what always fits.
- **`actions`** are up to three buttons. A tap hands its `target` to `onTaps`; an action with a
  `url` opens the app at that link instead.

## The options

- **`channel`** is the notification channel, which the user sees by `name` in the app's
  notification settings. It is created, silent, when it does not exist yet.
- **`id`** tells one notification from another on the same channel. It is the channel's id unless
  given.
- **`url`** opens the app at that link when the notification itself is tapped. Without one the
  tap opens the app.
- **`onTaps`** is called with the targets of the actions tapped since the last call, oldest first.

Its icon is the app's notification icon, the one the `expo-notifications` plugin sets in
`app.json`, and the app's own icon without one. Android draws only the icon's shape, in one color,
so an app icon that fills its square is drawn as a blank shape.

## What it does

- **`start()`** asks for the notification permission where Android 13 and later need it, shows the
  notification with the signal's current value, and answers whether it is showing. One left
  showing from before the app started is picked up without it.
- **Updates** follow the signal while the notification is showing, and make no sound.
- **`end()`** removes it.
- **`active`** is a signal. It turns false when the user swipes the notification away, and a
  change to the signal does not show it again.
- **`promoted`** is whether Android shows it as a Live Update, and **`openPromotionSettings()`**
  opens the screen where the user turns that on for the app.
- **`error`** holds why the last start or update failed, for example notifications turned off for
  the app. A refused start is only kept there; an update that fails also goes to the
  `ErrorHandler`.

The notification outlives the app: destroying the component stops the updates and leaves it
showing.

## Taps

A tap on an action does not open the app. Android delivers it to `@ng-native/expo`'s native half,
starting the app's process when there is none, and the tap is stored. `onTaps` receives it at once
while the app is running, and otherwise when `ongoingNotification()` is next called for that
notification, so a tap made while the app is not running is handed over when it next runs, once.

## Live Updates

A Live Update is an ongoing notification Android promotes: it sits at the top of the notification
drawer and on the lock screen, with a chip in the status bar. Every notification made here asks for
that, and `promoted` says whether Android does it. It is false where Android has no Live Updates,
which includes the first release of Android 16, and where the user has turned them off for the app.
The notification is then an ordinary ongoing one, with the same timer, progress and actions.

## Only on Android

On iOS and the web there is no such notification, and `start()` answers false. The same is so in
Expo Go and in a build made before `@ng-native/expo` was installed, which do not have its native
half.

## Testing

Provide `ONGOING_NOTIFICATIONS` from `@ng-native/expo/ongoing-notification` with a stand-in for the
native module: an object with `show`, `cancel`, `isActive`, `takeTaps`, `openPromotionSettings`
and `onChange`. Without one, in Node, `start()` answers false.
