---
title: Live Activities
summary: Show what's happening now on the lock screen and in the Dynamic Island, from a signal.
---

# Live Activities

`liveActivity()` keeps an iOS Live Activity in step with a signal: start it, and every change to the
signal updates the lock screen banner and the Dynamic Island until you end it. The Live Activity
itself comes from `expo-widgets`.

## Install

```sh
npx expo install expo-widgets @expo/ui
```

Add `expo-widgets` to the plugins in `app.json`, then run `npx expo prebuild -p ios`:

```json
{
  "expo": {
    "plugins": ["@ng-native/metro", ["expo-widgets", {}]]
  }
}
```

```ts
import { liveActivity } from '@ng-native/expo/live-activity';
```

## The layout

A Live Activity's look is drawn by the widget extension, not by your app, so the layout is a
component of its own that the app never renders. Pass it to `createLiveActivity` from
`@ng-native/expo/live-activity`, rather than `expo-widgets`' own: `@ng-native/metro` compiles its
template, at build time, to the source the extension runs, and drops the class. The activity's
props type comes from the layout's `props` input. Each `<ng-template>` names one of the activity's
slots.

```ts
// src/app/live/score-activity.ts
import { Component, input } from '@angular/core';
import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { UiText } from '@ng-native/expo/expo-ui-components';
import { createLiveActivity } from '@ng-native/expo/live-activity';

export interface Scoreline {
  us: string;
  them: string;
}

@Component({
  selector: 'score-activity',
  imports: [UiText],
  template: `
    <ng-template #banner>
      <ui-text [modifiers]="[font({ size: 34, weight: 'heavy' })]">
        Us {{ props().us }} - {{ props().them }} Them
      </ui-text>
    </ng-template>
    <ng-template #compactLeading>
      <ui-text [modifiers]="[foregroundStyle(ball)]">{{ props().us }}</ui-text>
    </ng-template>
    <ng-template #compactTrailing
      ><ui-text>{{ props().them }}</ui-text></ng-template
    >
    <ng-template #minimal
      ><ui-text>{{ props().us }}</ui-text></ng-template
    >
  `,
})
class ScoreLayout {
  readonly props = input.required<Scoreline>();
  protected readonly font = font;
  protected readonly foregroundStyle = foregroundStyle;
  protected readonly ball = '#d7f23c';
}

export const scoreActivity = createLiveActivity('Score', ScoreLayout);
```

The template is type-checked like any other, so a prop the `props` type does not have or an input
of the wrong type fails `ngc`. The slots are `banner`, for the lock screen, and `compactLeading`,
`compactTrailing`, `minimal`, `expandedLeading`, `expandedTrailing`, `expandedCenter` and
`expandedBottom`, for the Dynamic Island.

### What a layout can hold

The extension runs the layout with no Angular and no instance of the class, so:

- **The class** holds its `props` input, members set to a modifier from
  `@expo/ui/swift-ui/modifiers`, and members set to a literal: a string, number, boolean, `null`,
  or an array or object of them. A method, another input, or any other value is a build error
  naming the member and its line. The build removes the class, so it is not exported, and nothing
  but the call it is passed to names it.
- **The template** is inline, and draws `ui-text`, `ui-hstack`, `ui-vstack`, `ui-zstack`,
  `ui-spacer`, `ui-divider`, `ui-image`, `ui-progress`, `ui-gauge`, `ui-chart`, `ui-label`,
  `ui-link`, `ui-accessory-widget-background` and the shapes (`ui-rectangle`,
  `ui-rounded-rectangle`, `ui-uneven-rounded-rectangle`, `ui-capsule`, `ui-circle`, `ui-ellipse`),
  imported from `@ng-native/expo/expo-ui-components`. A `ui-link` is how a tap opens the app at a
  deep link. It can use `@if`, `@for`, `@switch` and `@let`; a `@let` before the slots is shared by
  all of them.
- **A `ui-text`'s text** is what is written inside it, with whitespace collapsed as Angular
  collapses it; `&nbsp;` keeps a wider gap. A `ui-text` inside another is a build error: the
  extension drops a view nested in a text.
- **A `ui-button`** needs a `target`, which is what its tap hands the app: see [Buttons](#buttons).
  In a home-screen widget it records the target for the app to collect with
  [`widget()`](/packages/expo/widget#the-layout), and its `(buttonPress)` is an object of the props
  to change at once. A Live Activity's props are the app's to change, so a `(buttonPress)` there is
  a build error.
- **Any other event, pipes, references, content projection, and class, style or attribute
  bindings** are build errors, with the line and column in the file.

### Buttons

A `ui-button` in a slot is a button on the lock screen or in the expanded Dynamic Island. Import
`UiButton` beside the layout's other views, give the button a `target`, and `liveActivity()` hands
that to `onTaps` when it is tapped:

```ts
template: `
  <ng-template #banner>
    <ui-hstack>
      <ui-text>Us {{ props().us }} - {{ props().them }} Them</ui-text>
      <ui-button target="us" label="Point us" />
      <ui-button target="them"><ui-text>Point them</ui-text></ui-button>
    </ui-hstack>
  </ng-template>
`,
```

```ts
protected readonly lockScreen = liveActivity(
  scoreActivity,
  computed(() => ({ us: this.match.us(), them: this.match.them() })),
  { onTaps: (taps) => taps.forEach((side) => this.match.point(side)) },
);
```

The tap runs in your app, not in the extension: iOS wakes the app in the background, without
opening it, and the app changes the signal, which updates the activity.

- **Buttons need iOS 17.** Before it the button is drawn, and its tap does not reach `onTaps`.
- **A tap is not kept.** It reaches `onTaps` while the app is running or suspended. When iOS has
  to start the app to run the tap, the tap is over before the app is listening, and that one is
  lost; the next one arrives. For a tap that must not be lost, use a `ui-link`: it opens the app at
  its `destination`, which a cold start still receives.
- **A press can run while the phone is locked.** The app is then woken with the phone still
  locked, when a keychain item stored as readable only while unlocked cannot be read. Store what
  `onTaps` needs as readable after the first unlock.
- **There is no toggle.** The extension draws buttons and links, and no `ui-toggle`.

### Home-screen widgets

`createWidget` takes a layout the same way. A widget's template is one root view rather than slots,
and an `environment` input beside `props` holds what the widget is drawn in, such as its
`widgetFamily`:

```ts
import { createWidget } from '@ng-native/expo/live-activity';
import type { WidgetEnvironment } from 'expo-widgets';

@Component({
  selector: 'habits-widget',
  imports: [UiText],
  template: `
    @switch (environment().widgetFamily) {
      @case ('systemSmall') {
        <ui-text>{{ props().done }}</ui-text>
      }
      @default {
        <ui-text>{{ props().done }} habits done today</ui-text>
      }
    }
  `,
})
class HabitsLayout {
  readonly props = input.required<{ done: number }>();
  readonly environment = input.required<WidgetEnvironment>();
}

export const habits = createWidget('Habits', HabitsLayout);
```

## Keep it in step from Angular

```ts
import { Component, computed, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { liveActivity } from '@ng-native/expo/live-activity';
import { scoreActivity } from './live/score-activity.ts';
import { Match } from './match.ts';

@Component({
  selector: 'app-scoreboard',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="lockScreen.active() ? lockScreen.end('immediate') : lockScreen.start()">
      <text>{{ lockScreen.active() ? 'Stop showing the score' : 'Show on lock screen' }}</text>
    </pressable>
  `,
})
export class Scoreboard {
  private readonly match = inject(Match);
  protected readonly lockScreen = liveActivity(
    scoreActivity,
    computed(() => ({ us: this.match.us(), them: this.match.them() })),
  );
}
```

Call it in an injection context, such as a field of a component or service.

## What it does

- **`start()`** shows the activity with the signal's current value, and answers whether it did. A
  Live Activity already running from before the app started is picked up rather than started again:
  iOS limits how many one app can run.
- **Updates** follow the signal while the activity is live.
- **`end(dismissal)`** ends every activity of that kind with the final value. `dismissal` is
  `'default'`, `'immediate'` or `{ after: date }`. With `'default'`, iOS keeps the ended activity on
  the lock screen, with its final value, for up to four hours, above any started after it; a button
  that ends one and can start the next wants `'immediate'`.
- **`active`**, **`id`** and **`pushToken`** are signals. The push token is for updating the
  activity from a server through APNs.
- **`onTaps`**, in the options, is called with the `target` of each
  [button](#buttons) tapped on a running activity of this kind. A handler that throws goes to the
  `ErrorHandler`.
- **`error`** holds why the last start or update failed, for example Live Activities turned off in
  Settings. A refused start is only kept there; an update that fails also goes to the
  `ErrorHandler`.

The activity outlives the app: destroying the component stops the updates but leaves it on the lock
screen until it is ended or the system removes it.

## Only on iOS

Live Activities need iOS 16.4 or newer, the oldest version `expo-widgets` and Expo build for. On
Android and the web, `expo-widgets` answers with a stand-in, and `start()` answers false.

## Testing

A layout file imports in a Vitest test as it is: with no `expo-widgets` to hand the layout to,
`createLiveActivity` answers an activity that never starts. To check what the app sends, pass
`liveActivity` a stand-in for the factory instead, an object with `start(props)` and
`getInstances()`.
To tap a button, provide `WIDGET_EVENTS` from `@ng-native/expo/widget` with a stand-in whose
`onTap` keeps the listener, and call it with the activity's id as `source` and the button's
`target`.
