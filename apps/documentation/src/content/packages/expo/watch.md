---
title: Apple Watch
summary: Talk to a SwiftUI Apple Watch app from Angular, with messages, shared context, queued data and files.
---

# Apple Watch

`Watch` connects an Angular Native app to its Apple Watch companion through Apple's
WatchConnectivity, bound to `react-native-watch-connectivity`. The watch app itself is SwiftUI:
React Native does not run on watchOS, so the phone side is Angular and the watch side is native.

Only apps that install `react-native-watch-connectivity` get its native code. Without it, on
Android, or with no paired watch, `Watch` is inert: `available` is false, the signals stay at their
defaults and sending rejects.

## Install

```sh
npx expo install react-native-watch-connectivity @bacons/apple-targets
```

```ts
import { Watch } from '@ng-native/expo/watch';
```

## Add the watch app

`@bacons/apple-targets` adds the watch target to the Xcode project on every `npx expo prebuild`, so
it survives a clean prebuild. Add it to the plugins in `app.json`, then create
`targets/watch/expo-target.config.js`:

```js
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'MyWatch',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '11.0',
  frameworks: ['SwiftUI', 'WatchConnectivity'],
};
```

Every Swift file in `targets/watch` belongs to the watch app. The smallest one activates a session,
shows what the phone sent and can message the phone:

```swift
import SwiftUI
import WatchConnectivity

final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  @Published var value = ""

  override init() {
    super.init()
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    DispatchQueue.main.async { self.value = "\(message["value"] ?? "")" }
    replyHandler(["received": true])
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    DispatchQueue.main.async { self.value = "\(context["value"] ?? "")" }
  }
}

@main
struct MyWatchApp: App {
  @StateObject private var link = PhoneLink()

  var body: some Scene {
    WindowGroup {
      VStack {
        Text(link.value)
        Button("Ping phone") { WCSession.default.sendMessage(["from": "watch"], replyHandler: nil) }
      }
    }
  }
}
```

Run `npx expo prebuild -p ios --clean` after adding the target. A device build is signed with your
team, set as `ios.appleTeamId` in `app.json`.

## Use it from Angular

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Watch } from '@ng-native/expo/watch';

@Component({
  selector: 'app-scoreboard',
  imports: [Pressable, Text],
  template: `
    <text>{{ watch.reachable() ? 'Watch is open' : 'Watch is asleep' }}</text>
    <text>From the watch: {{ watch.message()?.['from'] }}</text>
    <pressable (press)="show(42)"><text>Show 42 on the watch</text></pressable>
  `,
})
export class Scoreboard {
  protected readonly watch = inject(Watch);

  protected show(score: number): void {
    this.watch.update({ value: score });
  }
}
```

## Which channel to use

WatchConnectivity has four ways to send, and the right one depends on whether the watch app is open:

| Method                    | Arrives                                                                                     | Use it for                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `send(message)`           | Now, and resolves to the watch's reply. Rejects unless the watch app is open and reachable. | Live interaction while both apps are on screen.                     |
| `update(context)`         | When the watch app next runs, replacing the previous context.                               | The current state: a score, a setting. Works with the watch asleep. |
| `transfer(userInfo)`      | When the watch app next runs, every one in order.                                           | Events that must not be lost.                                       |
| `sendFile(uri, metadata)` | In the background. Progress is in `transfers`.                                              | Images, recordings.                                                 |

`transferComplication(info)` is `transfer` with priority, for a watch face complication. `sendData`
sends a string as a live message.

## What the watch sends

- `message` holds the last live message. To answer a message the watch sent with a reply handler,
  register `onMessage(handler)`: what the handler returns, or resolves to, is the reply, merged
  across handlers. The watch always gets a reply, an empty one if a handler throws or none is
  registered, so it is never left waiting.
- `context` holds the latest application context the watch sent, and starts as the last one
  received before the app launched. `currentContext()` reads the one the phone last sent.
- `userInfo` holds every user info the watch has queued, oldest first, however many deliveries
  it came in. `files` holds the last files received.
- `error` holds the last session error, by kind.

## Reachability

`reachable` is true only while the watch app is open and its session active: live messages need
that. iOS reports a change of reachability, but not the state an app starts in, and a session reads as
unpaired until it has activated, which no event reports. So `Watch` asks again as it starts until
the watch reads as paired, and also takes the state from `status()`, which reads `paired`, `installed` and `reachable` at once, from any message
the watch sends, and from whether a live message got through. Prefer `update` or `transfer` for
anything that should reach a watch that may be asleep.

## Testing on simulators

Pair a watch simulator with an iPhone simulator, then build the app: the watch app is built and
embedded with it. Install the phone app on the iPhone and the watch app, found in the phone app's
`Watch` folder, on the watch. The watch simulator sleeps after a few seconds, which makes it
unreachable; `update` still arrives.

## Testing

`Watch.SOURCE` stands in for the watch:

```ts
{ provide: Watch.SOURCE, useValue: fakeWatch }
```
