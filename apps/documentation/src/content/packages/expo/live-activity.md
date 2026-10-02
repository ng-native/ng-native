---
title: Live Activities
summary: Show what's happening now on the lock screen and in the Dynamic Island, kept in step with a signal.
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

A Live Activity's look is drawn by the widget extension, not by your app, so it is written in a
file of its own with `@expo/ui`'s SwiftUI components. Mark the function `'widget'`: the build turns
it into a string the extension runs, so the file can only use its props and those components.
`tsconfig.json` needs `"jsx": "react-jsx"` for it.

```tsx
// src/app/live/score-activity.tsx
import { Text } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

export interface Scoreline {
  us: string;
  them: string;
}

const ScoreActivity: LiveActivityComponent<Scoreline> = (score) => {
  'widget';
  return {
    banner: <Text>{`Us ${score.us} - ${score.them} Them`}</Text>,
    compactLeading: <Text>{score.us}</Text>,
    compactTrailing: <Text>{score.them}</Text>,
    minimal: <Text>{score.us}</Text>,
  };
};

export const scoreActivity = createLiveActivity<Scoreline>('Score', ScoreActivity);
```

## Keep it in step from Angular

```ts
import { Component, computed, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { liveActivity } from '@ng-native/expo/live-activity';
import { scoreActivity } from './live/score-activity.tsx';
import { Match } from './match.ts';

@Component({
  selector: 'app-scoreboard',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="lockScreen.active() ? lockScreen.end() : lockScreen.start()">
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
  `'default'`, `'immediate'` or `{ after: date }`.
- **`active`**, **`id`** and **`pushToken`** are signals. The push token is for updating the
  activity from a server through APNs.
- **`error`** holds why the last start failed, for example Live Activities turned off in Settings.
  An update that fails also goes to the `ErrorHandler`.

The activity outlives the app: destroying the component stops the updates but leaves it on the lock
screen until it is ended or the system removes it.

## Only on iOS

Live Activities need iOS 16.2 or newer. On Android and the web, `expo-widgets` answers with a
stand-in, and `start()` answers false.

## Testing

Pass a stand-in for the factory, an object with `start(props)` and `getInstances()`. Mock the layout
file in a Vitest test, since `expo-widgets` needs Expo's runtime.
