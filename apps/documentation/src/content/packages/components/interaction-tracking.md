---
title: Interaction tracking
summary: Every tap, long press, scroll, swipe and gesture as a plain event for an analytics tool.
---

# Interaction tracking

An analytics or monitoring tool built for React Native usually learns about taps by wrapping React
Native's own `Pressable`, `TouchableOpacity`, `Text` and `ScrollView` components. None of those
render in an Angular Native app: `<pressable>`, `<touchable-opacity>`, a pressable `<text>` and
`<scroll-view>` are host views driven by this package's own press handling. Such a tool still
records sessions, network requests and errors, but no interactions.

`provideInteractionObserver` fills that gap. The press machine reports every press it fires, and
every scroll view every drag, as a plain `InteractionEvent`, and the app maps it to whatever its
tool takes. Nothing here is specific to one tool.

```ts
import { provideInteractionObserver } from '@ng-native/components';

export const appConfig: ApplicationConfig = {
  providers: [
    provideInteractionObserver((event) => {
      if (event.type === 'click') {
        analytics.trackTap({
          name: event.label ?? event.element,
          id: event.testID,
          x: event.pageX,
          y: event.pageY,
        });
      }
    }),
  ],
};
```

It can be given more than once, and every observer hears every interaction. An app that registers
none pays nothing: a press looks for observers only once it has fired, and a scroll view listens for
drags only when there are observers to tell.

## What is reported

| `type`       | When                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `click`      | A control fires `press`: a touch lifted on it, or on Android a click from a keyboard, the D-pad or TalkBack.             |
| `long-press` | A control fires `longPress`, which needs a `(longPress)` listener, as in React Native. That press is not also a `click`. |
| `scroll`     | The finger lifts after dragging a `<scroll-view>` or `<virtual-list>`.                                                   |
| `swipe`      | The same, when the content was still moving at `SWIPE_VELOCITY` points per millisecond or faster as the finger lifted.   |
| `gesture`    | A native gesture that ended and is none of the above: a slower pan, a pinch, a rotation. See [Gestures](#gestures).      |

A `click` is reported whether or not anything listens to `(press)`, since a control that does
nothing when tapped is what an observer looking for dead taps wants to know about. A press the
finger dragged off, a press a scrolling list took over, a disabled control, a `<text>` that is not
`pressable`, a drag that ended where it started, and a scroll made by code report nothing.

Some controls are drawn by the platform rather than pressed through this package's press handling,
and report a `click` from their own native event instead:

- `<switch>`, each time the user flips it, on every platform. The event does not say whether it is
  now on or off, since that can be user data; read the app's own state for that.
- `<native-button>` where the platform draws it, a UIButton on iOS and an NSButton on macOS, when it
  fires `press`. On Android it is pressed through the responder like a `<pressable>`, and reported
  as one.

These carry no touch point, so their `source` is `click`. A disabled one reports nothing.

Each event carries:

- `element`: the element's name as written in the template, such as `pressable`, `text` or
  `scroll-view`, or a component's own selector where `PressBehavior` is composed onto it.
- `component`: the selector of the nearest component the control is rendered inside, so taps on
  every `<app-button>` can be told apart from taps on every `<app-list-row>` when both draw a
  `<pressable>`. A `<pressable>` in a button's template reports the button, even with the button
  in a card, and a control projected into a component's `<ng-content>` reports that component.
  A component that is the control itself, through `PressBehavior`, is named by `element`, and
  `component` is then the one around it. Absent for a control in the root component's own
  template.
- `label`, `testID`, `nativeID` and `role`: what the element committed, so a label a component
  gave it or a role it implies is the one reported, as a screen reader hears it.
- `text`: for a `click` and a `long-press`, never a `scroll` or `swipe`, the text inside the
  control, joined with single spaces and cut to 100 characters.
- `nativeTag`: the tag the control's own native view was committed with, not that of the view
  inside it the finger landed on. `null` on the web.
- `pageX` and `pageY`, where the touch was in the window, and `locationX` and `locationY`, where it
  was in the view it landed on. Absent for a press that had no touch.
- `width` and `height`: the control's size, once it has been laid out.
- `direction`: `up`, `down`, `left` or `right`. For a scroll view's scroll or swipe, the way the
  content moved into view, so `down` shows what was below. For a native gesture, the way the finger
  moved, so `down` is towards the bottom of the screen. A diagonal movement goes by the axis it
  moved further along.
- `gesture`, `distance` and `scale`: for an event from a native gesture, see [Gestures](#gestures).
- `source`: `touch`, or `click` for a press with no touch, such as a switch the user flipped.
- `timestamp`, in milliseconds since the epoch.

Observers run after the control's own `(press)` handler, so what the tap does is not held up by
recording it. One that throws is reported once with `console.warn`, and neither the other observers
nor the app are stopped by it.

On the web host, taps are reported, with a `nativeTag` of `null` and no `component`, and scrolls
are not, since a browser's scroll has no drag events to report them from.

## Gestures

A native gesture attached with `[gesture]` from `@ng-native/components/gestures` is reported when it
ends successfully, once, after its own `onEnd`. A gesture that fails or is cancelled, such as a pan
a scroll view took over, reports nothing, and nothing is reported while it moves.

| Gesture                             | `type`                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Gesture.Tap()`                     | `click`, with `pageX`, `pageY`, `locationX`, `locationY` and the `text` inside the element.                                                            |
| `Gesture.LongPress()`               | `long-press`, with the same.                                                                                                                           |
| `Gesture.Fling()`                   | `swipe`, with the `direction` it was set to, or the way the finger moved when set to several, and the `distance` the finger moved.                     |
| `Gesture.Pan()`                     | `swipe` when released at `SWIPE_VELOCITY` or faster, otherwise `gesture`. Either way with `direction` and `distance`, in points from where it started. |
| `Gesture.Pinch()`                   | `gesture`, with the `scale` it ended at.                                                                                                               |
| `Gesture.Rotation()` and the others | `gesture`.                                                                                                                                             |

Every such event carries `gesture`, the builder's name: `tap`, `long-press`, `fling`, `pan`,
`pinch`, `rotation`, `manual` and so on, so a tap gesture can be told from a pressed control. The
element, `label`, `testID`, `nativeID`, `role` and `nativeTag` are the element the gesture is
attached to, and `component` the component around it, as for a pressed control. A composed gesture
(`Gesture.Race`, `Gesture.Simultaneous`, `Gesture.Exclusive`) reports each gesture in it that
ended; in a race that is the one that won. `Gesture.Hover()` and `Gesture.Native()` report nothing:
the first is a pointer passing over, and the second is the wrapped view's own touch handling, which
a scroll view or a pressable control reports itself.

A gesture whose callbacks are worklets ends on the UI thread, and its report is scheduled onto the
JavaScript thread, so observers always run there, after the gesture's own `onEnd`.
Whether to report is decided when the gesture is attached: with no observers, a gesture does no
reporting work. To keep an element's gestures out of the reports, such as a drawing surface whose
every stroke is not worth recording, set `trackGesture` to `false`:

```html
<view [gesture]="draw" [trackGesture]="false"></view>
```

On the web host, `[gesture]` attaches nothing, so nothing is reported.

## Privacy

`text` holds whatever the control shows, which can be someone's name, an amount or a message, and
`label` can too. Redact what your tool should not receive in the observer, before it leaves the
device:

```ts
provideInteractionObserver(({ text, ...event }) => analytics.track(event));
```
