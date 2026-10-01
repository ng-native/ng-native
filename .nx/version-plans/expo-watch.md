---
__default__: minor
---

`@ng-native/expo/watch` connects an app to its Apple Watch companion: `Watch` sends live messages, shared context, queued user info, complication updates and files, and holds what the watch sends as signals.

It is bound to `react-native-watch-connectivity`, an optional peer, so only apps that install it get its native code. The watch app is SwiftUI, added with `@bacons/apple-targets`; the Apple Watch page shows the setup, and `examples/padel` is a whole app built on it. iOS reports neither the state an app starts in nor when its session has activated, so `Watch` asks again until it has, holds context and user info sent before then, and keeps `reachable` from `status()`, the watch's messages and whether a live message got through as well as from iOS's change events. Elsewhere, and with no paired watch, `Watch` is inert; on iOS, a build without its native module, such as Expo Go, throws a `MissingModuleError` that says what to install and to rebuild.
