---
title: Home screen widgets
summary: A home screen widget that shows a signal and hands the app the taps on its buttons.
---

# Home screen widgets

`widget()` keeps a home screen widget in step with a signal, and hands the app the taps on the
widget's buttons, including taps made while the app was not running. The widget itself comes from
`expo-widgets`.

## Install

```sh
npx expo install expo-widgets @expo/ui
```

List the widget in the `expo-widgets` plugin in `app.json`, then run `npx expo prebuild -p ios`:

```json
{
  "expo": {
    "plugins": [
      "@ng-native/metro",
      [
        "expo-widgets",
        {
          "widgets": [
            {
              "name": "Score",
              "displayName": "Score",
              "description": "The score, with a button for each side.",
              "supportedFamilies": ["systemSmall", "systemMedium"]
            }
          ]
        }
      ]
    ]
  }
}
```

```ts
import { widget } from '@ng-native/expo/widget';
```

## The layout

The widget extension draws the widget, not your app, so its layout is a component of its own,
compiled at build time to the source the extension runs, as for
[Live Activities](/packages/expo/live-activity). It reads `props()`, and `environment()` for what
the widget is drawn in, such as its `widgetFamily`.

A `<ui-button>` needs a `target`. A tap runs in the extension while the app may be suspended, so
it records the target in the props, as `taps`, for `widget()` to hand to the app. Its
`(buttonPress)` is an object of the props to change at once, so the widget shows the tap before
the app has seen it:

```ts
// src/app/live/score-widget.ts
import { Component, input } from '@angular/core';
import { UiButton, UiHStack, UiText, UiVStack } from '@ng-native/expo/expo-ui-components';
import { createWidget } from '@ng-native/expo/live-activity';

export interface Score {
  us: number;
  them: number;
}

@Component({
  selector: 'score-widget',
  imports: [UiButton, UiHStack, UiText, UiVStack],
  template: `
    <ui-vstack>
      <ui-text>{{ props().us }} - {{ props().them }}</ui-text>
      <ui-hstack>
        <ui-button target="us" (buttonPress)="{ us: props().us + 1 }">
          <ui-text>Us</ui-text>
        </ui-button>
        <ui-button target="them" (buttonPress)="{ them: props().them + 1 }">
          <ui-text>Them</ui-text>
        </ui-button>
      </ui-hstack>
    </ui-vstack>
  `,
})
class ScoreWidget {
  readonly props = input.required<Score>();
}

export const scoreWidget = createWidget('Score', ScoreWidget);
```

The name passed to `createWidget` is the one in `app.json`. A Live Activity has nowhere to record
a tap, so a button there is a build error.

## Keep it in step from Angular

```ts
import { Component, computed, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { widget } from '@ng-native/expo/widget';
import { scoreWidget } from './live/score-widget.ts';
import { Match } from './match.ts';

@Component({
  selector: 'app-scoreboard',
  imports: [Text],
  template: `<text>{{ match.us() }} - {{ match.them() }}</text>`,
})
export class Scoreboard {
  protected readonly match = inject(Match);
  protected readonly homeScreen = widget(
    scoreWidget,
    computed(() => ({ us: this.match.us(), them: this.match.them() })),
    { onTaps: (taps) => taps.forEach((side) => this.match.point(side)) },
  );
}
```

Call it in an injection context, such as a field of a component or service.

## What it does

- **The widget follows the signal.** Every change is written to the widget, which replaces the
  props it holds, `taps` included.
- **Taps reach `onTaps` once each,** oldest first: at once while the app is running, and when it
  comes back to the foreground. Taps recorded while it was not running are collected as it starts,
  before anything is written over them. A handler that throws goes to the `ErrorHandler`, and its
  taps are still cleared.
- **iOS redraws a widget on its own schedule,** so the home screen can show the last version for a
  moment after the app changed it. Going to the background asks iOS to redraw it.
- **`sync()`** collects the taps now, and **`reload()`** asks iOS to redraw the widget.

The app stays the one source of truth: a widget's own change to what it shows lasts until the app
collects the taps and writes its value back.

## Testing

Pass a stand-in for the widget, an object with `updateSnapshot`, `getTimeline` and `reload`, and
provide `WIDGET_EVENTS` to tap it. Mock the layout file in a Vitest test, since `createWidget` needs
the build step that compiles it.
