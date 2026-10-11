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

The name passed to `createWidget` is the one in `app.json`. A Live Activity's button has no
`(buttonPress)`: its tap goes [straight to the app](/packages/expo/live-activity#buttons).

### What its user chooses

A widget can have settings its user edits on the home screen, by holding the widget and choosing
Edit Widget. List them in `app.json`, as the widget's `configuration`:

```json
{
  "name": "Score",
  "displayName": "Score",
  "description": "The score, with a button for each side.",
  "ios": {
    "supportedFamilies": ["systemSmall", "systemMedium"],
    "configuration": {
      "title": "Score",
      "parameters": {
        "side": {
          "title": "Side",
          "type": "enum",
          "values": [
            { "name": "Us", "value": "us" },
            { "name": "Them", "value": "them" }
          ],
          "default": "us"
        },
        "showGames": { "title": "Show games", "type": "boolean", "default": true }
      }
    }
  }
}
```

The layout reads what was chosen from `environment().configuration`, typed by the `environment`
input:

```ts
readonly environment = input.required<WidgetEnvironment<{ side: 'us' | 'them'; showGames: boolean }>>();
```

```html
@if (environment().configuration.showGames) {
<ui-text>Games {{ props().games }}</ui-text>
}
```

- **A widget with settings needs iOS 17.** Before it, the widget is not offered at all, with its
  defaults or otherwise.
- **A parameter's `type`** is `string`, `number`, `boolean` or `enum`, and each has a `default`.
- **Each widget on the home screen has its own choices,** so two of one kind can show different
  things from the same props.
- **The extension holds the choices, not the app:** the layout reads them, and `widget()` is not
  told.
- **A change to the parameters** needs `npx expo prebuild -p ios` and a rebuild.

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

- **The widget follows the signal.** A write replaces the props the widget holds, `taps` included,
  so each one comes after the taps are read, and nothing is written while they cannot be.
- **Taps reach `onTaps` once each,** oldest first, after the write that clears them: at once while
  the app is running, when it comes back to the foreground, and as it starts. A handler that
  throws, or rejects, goes to the `ErrorHandler`, and its taps are still cleared.
- **`error`** holds why the last sync did not happen: the taps could not be read, or the widget not
  written. It also goes to the `ErrorHandler`, and is null again once a sync works.
- **iOS redraws a widget on its own schedule,** so the home screen can show the last version for a
  moment after the app changed it. Going to the background asks iOS to redraw it.
- **`sync()`** collects the taps now, and **`reload()`** asks iOS to redraw the widget.

### Later, with the app closed

A widget runs no code of the app's, so what it shows changes only when the app writes it. To change
it at a known time with the app closed, give `widget()` a `timeline`: the entries after now, each
the props to show from its date.

```ts
protected readonly homeScreen = widget(
  scoreWidget,
  computed(() => ({ us: this.match.us(), them: this.match.them(), endsAt: this.match.endsAt() })),
  { timeline: (now) => [{ date: new Date(now.endsAt), props: { ...now, over: true } }] },
);
```

The layout draws the entry's props as it draws any others, so it shows `over` for the change to be
seen:

```html
@if (props().over) {
<ui-text>Full time</ui-text>
}
```

- **It is asked at every write,** with the signal's props, which are shown until the first entry's
  date. Each write replaces the timeline before it. A signal it reads is not followed, so what it
  needs belongs in the props, as the time the match ends is here.
- **A tap is recorded in the entry showing when it was made,** and `onTaps` is handed the taps of
  every entry. A button's `(buttonPress)` changes only that entry, so an entry after it shows what
  it was written with until the app next writes.

The app stays the one source of truth: a widget's own change to what it shows lasts until the app
collects the taps and writes its value back.

## Only on iOS

Home screen widgets need iOS 16.4 or newer, the oldest version `expo-widgets` and Expo build for. On
Android and the web, `expo-widgets` answers with a stand-in, and `widget()` does nothing.

## Testing

Pass a stand-in for the widget, an object with `updateSnapshot`, `getTimeline` and `reload`, and
provide `WIDGET_EVENTS` to tap it. To check a `timeline`, give the stand-in an `updateTimeline` as
well, which is called with the entries; one without it is written the signal's props alone. In
Node, `createWidget` answers a stand-in that draws nothing, so a test can import the layout file as
it is.
