---
title: End-to-end tests
summary: Driving the real app on a simulator with Maestro, in Expo Go or a development build.
---

# End-to-end tests

A test on the fake Fabric proves what your components send to native. It cannot prove what native
does with it: layout, what is actually on screen, a real keyboard, a native gesture, a screen
transition, or anything a native module does. For those, drive the real app.
[Maestro](https://maestro.mobile.dev) is a good fit here, because it needs nothing inside the app:
it reads the platform's accessibility tree and taps, types and swipes through it the way a person
would, so it works the same whether the views came from React or from Angular.

## What each kind of test covers

| Question                                                     | Fake Fabric test | Maestro flow |
| ------------------------------------------------------------ | ---------------- | ------------ |
| Does the component render the right tree and props?          | Yes              | Indirectly   |
| Does a press, a change or a scroll reach the right handler?  | Yes              | Yes          |
| Do Signal Forms, services, `HttpClient` and routing behave?  | Yes              | Yes          |
| Is it laid out where it should be, and visible?              | No               | Yes          |
| Does typing on the real keyboard arrive intact?              | No               | Yes          |
| Do native gestures, transitions and animations run?          | No               | Yes          |
| Does a native module (camera, haptics, storage) do its part? | No               | Yes          |
| How long does it take?                                       | Milliseconds     | Seconds      |

Write most tests on the fake, where they are fast and exact, and a few Maestro flows for the
journeys that have to work on a device.

## Selectors

Maestro finds a view by its text, by its accessibility label, or by its id, and all three come
from props you already set:

- **`testID`** is the view's accessibility identifier on iOS and its resource id on Android. Maestro
  matches it with `id:`, and it is the most stable selector, because nobody reads it and nobody
  translates it. Note that it is `testID`, not `id` or `nativeID`: those commit as `nativeID`,
  which native does not expose to the accessibility tree. A fake Fabric test's `getByTestId`
  matches `nativeID` as well, so an `id` that works there needs a `testID` for Maestro.
- **`accessibilityLabel`** is what a screen reader says, and what Maestro matches with a plain
  string or `text:`. A label is worth having anyway, so it is often the selector that costs nothing.
- **Text** is matched the same way, and here the platforms differ. On iOS a `<pressable>` is one
  accessibility element whose label joins the text inside it with commas; on Android each `<text>`
  stays its own element. A row holding a title and a subtitle is matched on both by a pattern that
  allows either, such as `'Signal forms(, .*)?'`. Android also lists only what is on screen, so
  scroll to an element with `scrollUntilVisible` before tapping it.

Maestro matches a string as a regular expression against the whole label, so `'valid'` does not
match `'1 validation error(s)'`, and `'.*validation error.*'` does.

## With Expo Go

Expo Go is one app hosting many projects, so a flow launches Expo Go and opens the project's URL
in it, served by `npx expo start` on your machine. Keep the launch in a subflow, such as
`.maestro/subflows/open-app.yaml`, so `maestro test .maestro` does not run it as a test:

```yaml
appId: ${APP_ID || 'host.exp.Exponent'}
---
- stopApp
- launchApp
# Expo Go on Android drops a link that arrives while it is still starting.
- waitForAnimationToEnd
- openLink: ${METRO || 'exp://127.0.0.1:8081'}
# The first open bundles the app, which takes a while on a cold Metro.
- extendedWaitUntil:
    visible: 'My App'
    timeout: 60000
```

Each flow starts with `- runFlow: subflows/open-app.yaml`. With a simulator booted and Metro
running:

```sh
curl -fsSL "https://get.maestro.mobile.dev" | bash
maestro test .maestro
```

and on an Android emulator, where Expo Go's id is lowercase and the host is `10.0.2.2`:

```sh
maestro test -e APP_ID=host.exp.exponent -e METRO=exp://10.0.2.2:8081 .maestro
```

## With a development build

A development build is your own app with its own bundle identifier, so a flow launches it
directly rather than going through Expo Go. Build and install it once
(`npx expo run:ios` or `npx expo run:android`), start Metro with `npx expo start --dev-client`,
and open with `- launchApp` in place of the Expo Go subflow, passing the identifier from
`app.json` as `APP_ID`.

A release build (`npx expo run:ios --configuration Release`) needs no Metro at all, and is the
closest a flow gets to what a user runs: no development-mode checks, the release bundle, and the
real startup time.

## In CI

A flow runs in CI as it does on your machine, against a build on a simulator or emulator the job
starts; `maestro test` exits non-zero when a flow fails.
