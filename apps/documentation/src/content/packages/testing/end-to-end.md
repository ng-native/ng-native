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
  which native does not expose to the accessibility tree.
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
in it, served by `npx expo start` on your machine. This repository's canary app has two flows in
`examples/canary/.maestro`, and both start with this subflow:

```yaml
# Opens the canary in Expo Go, served by the Metro that `pnpm start` runs on this machine.
#
# Expo Go is one app hosting many projects, so there is no bundle of ours to launch: the flow
# restarts Expo Go, so the canary opens on its first screen rather than wherever the last flow
# left it, then opens the project's URL in it. Against a development build, replace everything
# below with `- launchApp` and pass `-e APP_ID=dev.angularnative.canary`.
#
# A subflow, kept out of the top level so `maestro test .maestro` does not run it as a test.
#
# `METRO` is the URL the device reaches Metro at, and `APP_ID` is Expo Go's id. The defaults are
# right for the iOS simulator. On the Android emulator Expo Go is `host.exp.exponent`, lowercase,
# and the host is 10.0.2.2: pass `-e APP_ID=host.exp.exponent -e METRO=exp://10.0.2.2:8081`.
appId: ${APP_ID || 'host.exp.Exponent'}
---
- stopApp
- launchApp
# Expo Go on Android drops a link that arrives while it is still starting, and stays on its own
# home screen.
- waitForAnimationToEnd
# Retried as insurance against the same drop on a slow start.
- retry:
    maxRetries: 2
    commands:
      - openLink: ${METRO || 'exp://127.0.0.1:8081'}
      # The first open bundles the app, which takes a while on a cold Metro.
      - extendedWaitUntil:
          visible: 'Angular Native'
          timeout: 60000
```

The forms flow types into a real text field and reads back what Signal Forms made of it:

```yaml
# Types into a real UITextField / EditText and reads back what Signal Forms made of it.
#
# The one thing the fake-Fabric tests cannot show: that characters typed on a keyboard arrive,
# in order, through the native change events and the eventCount echo.
appId: ${APP_ID || 'host.exp.Exponent'}
---
- runFlow: subflows/open-canary.yaml
# On iOS a feature row is one accessibility element whose label joins its title and blurb; on
# Android the title is its own text, and only what is on screen is listed. This matches both.
- scrollUntilVisible:
    element: 'Signal forms(, .*)?'
- tapOn: 'Signal forms(, .*)?'
- assertVisible: '.*validation error.*'
# The field has no label of its own; its placeholder is what the accessibility tree reports.
- tapOn: 'name'
- inputText: 'Ada Lovelace'
- assertVisible: 'valid'
- assertVisible: '.*"name":"Ada Lovelace".*'
```

With a simulator booted and the canary's Metro running (`pnpm start` in `examples/canary`):

```sh
curl -fsSL "https://get.maestro.mobile.dev" | bash
maestro test examples/canary/.maestro
```

and on an Android emulator, where Expo Go's id is lowercase and the host is `10.0.2.2`:

```sh
maestro test -e APP_ID=host.exp.exponent -e METRO=exp://10.0.2.2:8081 examples/canary/.maestro
```

Both flows pass on the iOS simulator and the Android emulator, but they are not run in CI: treat
them as a starting point rather than as a gate. What CI does run is below.

## With a development build

A development build is your own app with its own bundle identifier, so a flow launches it
directly rather than going through Expo Go. Build and install it once
(`npx expo run:ios` or `npx expo run:android`), start Metro with `npx expo start --dev-client`,
and open with `- launchApp` in place of the Expo Go subflow, passing the identifier from
`app.json` as `APP_ID`. For the canary that is `-e APP_ID=dev.angularnative.canary`.

A release build (`npx expo run:ios --configuration Release`) needs no Metro at all, and is the
closest a flow gets to what a user runs: no development-mode checks, the release bundle, and the
real startup time.

## In CI

This repository's native build workflow launches the canary's release build, on an iOS simulator and
on an Android emulator, and runs `examples/canary/.maestro/release/smoke.yaml` against each, on
every pull request that is ready for review and changes more than Markdown and the documentation
site. It is a smoke test, not a feature test: the first screen renders, a screen pushes and pops on
the native stack, a screen inside `<safe-area-view>` draws, and so does a screen of Tailwind
utilities that combine on one element. A release build that throws at startup closes, so nothing it
waits for appears and the flow fails; it also fails on React Native's error screen and on an
`Unimplemented component` placeholder, the two things drawn in place of an app. Against a release
build, on a simulator the script creates, or on a booted emulator:

```sh
examples/canary/scripts/smoke-ios.sh path/to/canary.app /tmp/maestro
examples/canary/scripts/smoke-android.sh path/to/app-release.apk /tmp/maestro
```
