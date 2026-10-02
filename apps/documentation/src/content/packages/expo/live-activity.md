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
component of its own that the app never renders. Pass it to `createLiveActivity` through
`widgetLayout`: `@ng-native/metro` compiles its template, at build time, to the source the
extension runs, and drops the class. Each `<ng-template>` names one of the activity's slots.

```ts
// src/app/live/score-activity.ts
import { Component, input } from '@angular/core';
import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { UiText } from '@ng-native/expo/expo-ui-components';
import { widgetLayout } from '@ng-native/expo/live-activity';
import { createLiveActivity } from 'expo-widgets';

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

export const scoreActivity = createLiveActivity<Scoreline>('Score', widgetLayout(ScoreLayout));
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
  naming the member and its line.
- **The template** is inline, and draws `ui-text`, `ui-hstack`, `ui-vstack`, `ui-spacer`,
  `ui-divider`, `ui-image`, `ui-progress` and `ui-gauge`, imported from
  `@ng-native/expo/expo-ui-components`. It can use `@if`, `@for`, `@switch` and `@let`; a `@let`
  before the slots is shared by all of them.
- **A `ui-text`'s text** is what is written inside it, with whitespace collapsed as Angular
  collapses it; `&nbsp;` keeps a wider gap. A `ui-text` inside another is a build error: the
  extension drops a view nested in a text.
- **Events, pipes, references, content projection, and class, style or attribute bindings** are
  build errors, with the line and column in the file.

### Home-screen widgets

`createWidget` takes a layout the same way. A widget's template is one root view rather than slots,
and an `environment` input beside `props` holds what the widget is drawn in, such as its
`widgetFamily`:

```ts
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

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

export const habits = createWidget('Habits', widgetLayout(HabitsLayout));
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
- **`error`** holds why the last start or update failed, for example Live Activities turned off in
  Settings. A refused start is only kept there; an update that fails also goes to the
  `ErrorHandler`.

The activity outlives the app: destroying the component stops the updates but leaves it on the lock
screen until it is ended or the system removes it.

## Only on iOS

Live Activities need iOS 16.4 or newer, the oldest version `expo-widgets` and Expo build for. On
Android and the web, `expo-widgets` answers with a stand-in, and `start()` answers false.

## Testing

Pass a stand-in for the factory, an object with `start(props)` and `getInstances()`. Mock the layout
file in a Vitest test, since `expo-widgets` needs Expo's runtime and the layout needs
`@ng-native/metro`'s transform.
