# Devices

How to reproduce and verify a bug on an iOS simulator or Android emulator without getting in the way of the
other sessions on the Mac. Read it before step 2 of [SKILL.md](SKILL.md) when the bug shows on a device.

## Rules

Other sessions use simulators, emulators and Metro too, so memory runs out before anything else does.

- Before booting a device, check memory: compressed memory under 9 GB on a 24 GB Mac (scale it for
  another), and swap not growing between two readings a minute apart. Otherwise wait and check every
  minute. Free percentage is the wrong signal.

  ```sh
  vm_stat | awk '/page size of/ {page=$(NF-1)} /occupied by compressor/ {printf "%.1f GB compressed\n", $5*page/2^30}'
  sysctl -n vm.swapusage
  ```

- A native build (Xcode or Gradle) runs one at a time, machine-wide, under a shared lock:
  `mkdir /tmp/ngn-build.lock` fails while another agent holds it, so retry every minute. `rmdir` it when the
  build finishes, even on failure. Booting and driving a device needs no lock.
- Create your own device and pass its id to every command. Never boot, reuse, tap on, close, uninstall from
  or restart a device or app you didn't create or launch. A tap on the shared simulator lands in someone
  else's app.
- Run your own Metro on a free port. Leave 8081, and every Metro you didn't start, alone.
- Prefer Expo Go to a native build when it covers the case. It does not when the fix touches native code or
  layout (see "Debug builds").
- Shut a device down as soon as nothing needs it, and delete it and stop your Metro at the end.

## Tools

Check what is installed before starting:

```sh
command -v idb idb_companion maestro
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
ls "$ANDROID_HOME/platform-tools/adb"
```

- **idb** (Meta's iOS driver) reads the accessibility tree and taps, types and swipes on a simulator. When it
  is missing, recommend installing it in the report (`brew install facebook/fb/idb-companion` and
  `pipx install fb-idb`) rather than installing it unasked, and fall back to `xcrun simctl` screenshots and a
  Maestro flow.
- **adb** may not be on `PATH`, and `ANDROID_HOME` may be unset; the export above covers both. `emulator`
  and `avdmanager` are under `$ANDROID_HOME/emulator` and `$ANDROID_HOME/cmdline-tools/latest/bin`.
  `avdmanager` and Gradle need `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.
- **Maestro** runs a YAML flow on either platform. It needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21`.

## Metro

In the example app the repro lives in (usually `examples/canary`), on a free port, with stdin closed and
without `CI=1`. `CI=1` turns off file watching, so every later edit is silently ignored.

```sh
PORT=8141   # any free port: lsof -ti tcp:$PORT prints nothing
(cd examples/canary && npx expo start --port $PORT < /dev/null > /tmp/ngn-<n>-metro.txt 2>&1 &)
```

- The app's `console.log` output lands in that log.
- After a change under `packages/metro` or to a transform, the running Metro keeps the old compiler. Kill your
  Metro by its PID (`lsof -ti tcp:$PORT`) and start it again with `--clear`.
- Do not switch branches in a worktree while its Metro is serving a device; the Tailwind watcher regenerates
  from the other branch and does not regenerate on switching back.

## iOS simulator

**Create and boot your own.** Pick a device type and runtime from `xcrun simctl list devicetypes` and
`xcrun simctl list runtimes` (`examples/canary/scripts/smoke-ios.sh` picks the newest iPhone with `jq`).

```sh
UDID=$(xcrun simctl create ngn-<n> "<device type name>" <runtime id>)
xcrun simctl boot $UDID && xcrun simctl bootstatus $UDID -b
export IDB_UDID=$UDID                       # idb reads it, so --udid can be left off
export AI_AGENT=claude-code                 # idb tells agent traffic apart by it
```

**Open the app in Expo Go.** Expo keeps Expo Go builds in `~/.expo/ios-simulator-app-cache`; install the one
whose major version matches the app's Expo SDK, then open your Metro. When the cache has none, copy Expo Go
from another simulator that has it: `xcrun simctl get_app_container <its udid> host.exp.Exponent` gives the
path, and reading it changes nothing there. Tap through the "Open in Expo Go?" prompt and the dev menu
intro on the first launch.

```sh
xcrun simctl install $UDID ~/.expo/ios-simulator-app-cache/Expo-Go-<version>.tar.app
xcrun simctl openurl $UDID exp://127.0.0.1:$PORT
```

To reload after an edit Metro did not hot-reload: `xcrun simctl terminate $UDID host.exp.Exponent`, then
`openurl` again.

**Drive it with idb.** `idb help agent` is idb's own guide for agents; read it once.

| To               | Run                                                                         |
| ---------------- | --------------------------------------------------------------------------- |
| Read the screen  | `idb ui describe-all --json` (every element, its label, value and frame)    |
| Read one element | `idb ui describe "<label>"`, or `idb ui describe-point X Y`                 |
| Tap by label     | `idb ui tap "<label>"`, or `--match-key AXUniqueId` with a `testID`         |
| Tap a point      | `idb ui tap X Y --reason "<why>"` (points, not pixels)                      |
| Type             | `idb ui text "hello"`; keys with `idb ui key <code>`                        |
| Scroll or drag   | `idb ui swipe X1 Y1 X2 Y2 --duration 0.3`, or `idb ui scroll` on an element |
| Screenshot       | `xcrun simctl io $UDID screenshot /tmp/ngn-<n>-before.png`                  |
| Video            | `idb video /tmp/ngn-<n>.mp4`, stopped with Ctrl-C (a kill to its PID)       |
| Native log       | `xcrun simctl spawn $UDID log stream --predicate 'process == "Expo Go"'`    |

Read the tree before and after an action rather than trusting a screenshot. It gives labels, values and
frames you can compare as text and quote in the PR.

What idb gets wrong:

- **A tap by label is not a touch.** It runs the element's accessibility action, so `Pressable`'s press-in
  and press-out, gesture handlers and hit-testing are skipped. That is the right check for a screen-reader
  bug and the wrong one for a touch bug. For a touch, take the element's centre from `describe-all` and tap
  the point.
- **A synthetic tap is instantaneous and perfectly still.** A thumb moves twenty points or more on a large
  control. When a touch report does not reproduce with a tap, reproduce the movement with a short `swipe`.
- **A screen-edge back swipe** cannot be synthesised in a way UIKit accepts.
- **The companion goes stale** when a simulator restarts, and then every tap reports success and does
  nothing. Run `idb kill` after a restart, and confirm a tap by reading the tree afterwards.
- **A screenshot takes about half a second,** so screenshots across a transition show only its ends, which
  looks the same as no animation. Record a video, or log the value from the app.
- **The software keyboard disappears** once `idb ui text` or key events make the simulator think a hardware
  keyboard is attached. Clear it inside the device and relaunch the app:
  `xcrun simctl spawn $UDID defaults write com.apple.keyboard.preferences HardwareKeyboardLastSeen -bool false`
  and the same for `AutomaticMinimizationEnabled`.

**Settings worth checking:** `xcrun simctl ui $UDID appearance dark`,
`xcrun simctl ui $UDID content_size extra-small` (and `extra-extra-large`; text that is right at the default
size can be off at others), `xcrun simctl status_bar $UDID override --time 9:41` for stable screenshots.

**Clean up:** `xcrun simctl shutdown $UDID && xcrun simctl delete $UDID`.

## Android emulator

**Create and boot your own AVD** from an installed image (`ls $ANDROID_HOME/system-images/*/*`), on a port of
its own so its serial is known. adb only finds emulators on even console ports from 5554 to 5584, so pick one there that `adb devices` does not list.

```sh
A=$ANDROID_HOME; ADB="$A/platform-tools/adb"; S=emulator-5580
JAVA_HOME=/opt/homebrew/opt/openjdk@17 "$A/cmdline-tools/latest/bin/avdmanager" create avd -n ngn-<n> -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7 < /dev/null
"$A/emulator/emulator" -avd ngn-<n> -port 5580 -no-snapshot -no-boot-anim -no-audio > /tmp/ngn-<n>-emu.txt 2>&1 &
"$ADB" -s $S wait-for-device
until [ "$("$ADB" -s $S shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
```

**Open the app in Expo Go.** Expo keeps the Expo Go APK in `~/.expo/android-apk-cache`.

```sh
"$ADB" -s $S install -r ~/.expo/android-apk-cache/Expo-Go-<version>.apk
"$ADB" -s $S reverse tcp:$PORT tcp:$PORT
"$ADB" -s $S shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:$PORT
```

**Drive it with adb.** `adb` below is `"$ADB" -s $S`: always name your emulator. Coordinates are pixels,
not dp.

| To                | Run                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Read the screen   | `adb shell uiautomator dump /sdcard/ui.xml && adb exec-out cat /sdcard/ui.xml` (labels and bounds) |
| Tap               | `adb shell input tap X Y`                                                                          |
| Type              | `adb shell input text 'hello'` (`%s` for a space)                                                  |
| Scroll or drag    | `adb shell input swipe X1 Y1 X2 Y2 300`                                                            |
| Back              | `adb shell input keyevent KEYCODE_BACK`                                                            |
| Screenshot        | `adb exec-out screencap -p > /tmp/ngn-<n>-before.png`                                              |
| Video             | `adb shell screenrecord /sdcard/ngn.mp4`, then `adb pull`                                          |
| JS and native log | `adb logcat -s ReactNativeJS ReactNative`                                                          |

`uiautomator dump` fails while anything on screen animates; retry, or wait for it to settle.

**Settings worth checking:** `adb shell cmd uimode night yes`,
`adb shell settings put system font_scale 0.85` (and `1.3`), `adb shell settings put global hide_error_dialogs 1`
on a slow emulator, where "isn't responding" dialogs can cover the app.

**Clean up:** `"$ADB" -s $S emu kill`, then `avdmanager delete avd -n ngn-<n>` (with `JAVA_HOME` as above).

## Maestro flows

When the repro has more than a few steps, write it as a flow in `/tmp/ngn-<n>.yaml` and run the same flow
before and after the fix, on either platform: `maestro --device <udid or serial> test /tmp/ngn-<n>.yaml`.
`examples/canary/.maestro/subflows` has subflows for opening the canary and waiting for a screen. Maestro is
slow (seconds a step), so it cannot check timing; test timing in Node.

## Debug builds

Expo Go is not enough when:

- **The fix touches native code** (`packages/expo/ios` or `android`). Expo Go runs its own copy of the
  native modules.
- **The fix touches layout.** Expo Go is a release build, so React Native's debug assertions are off: a
  layout a debug build aborts on just draws, or draws nothing, in Expo Go.

Build the canary for your own device, under the build lock:

```sh
cd examples/canary
npx expo run:ios --device $UDID --port $PORT
JAVA_HOME=/opt/homebrew/opt/openjdk@17 GRADLE_OPTS=-Dorg.gradle.daemon=false \
  npx expo run:android --device ngn-<n> --port $PORT
```

When `pod install` fails with `tapi error: malformed file ... MacOSX<version>.sdk`, xcrun picked the
Command Line Tools SDK: export
`SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`
and run it again.

`expo run:ios` leaves a Metro of its own running; check `lsof -ti tcp:$PORT` before starting another. A debug
build that crashes on an assertion writes its text to the console:
`xcrun simctl launch --console-pty --terminate-running-process $UDID dev.angularnative.canary -RCT_jsLocation 127.0.0.1:$PORT > /tmp/ngn-<n>-console.txt`
(the launch argument points it at your Metro; without it the build loads from 8081), then
`grep "Assertion failed"`. Open a canary route with `xcrun simctl openurl $UDID canary://<route>`.

Delete the generated `examples/canary/ios` and `android` folders when done: lint and typecheck scan them.

## What to record

For each platform: the device, OS version, Expo Go or debug build, the commands that reproduce the bug, and
the before and after artifacts with their paths. Prefer an artifact that can be compared as text (a tree
excerpt, a measured frame, a log line) to a screenshot, and give both when the bug is visual.
