---
name: screens-check
description: Compare how a change draws the canary's screens on iOS against main - the screens whose native output changed, each opened by deep link on one simulator in main's bundle and in the change's, tapped through with idb where a screen needs it, screenshotted with simctl and compared pair by pair. Use for a change that draws (the CSS engine, components, layout, text), when asked to check a pull request's screens, or when the PR gate's native output lists changed screens.
---

# Check a change's screens

`node scripts/pr-gate.mjs` says which screens' native output changed. This skill shows what that
looks like: each of those screens, main beside the change, on one simulator in one sitting, so a
difference is the change and not a runtime or a day.

Run everything from the repository root. Keep the simulator and the base worktree for the whole
run, and remove both at the end (step 6) whatever happened: a step that fails part way still ends
with step 6, which removes whichever of them was made.

## 1. Which screens

A checkout of the base beside this one, and what every screen sends native on each side:

```sh
out=$(mktemp -d -t screens-check)
git fetch -q origin main
git worktree add --detach "$out/base" "$(git merge-base origin/main HEAD)"
pnpm --dir "$out/base" install --frozen-lockfile --prefer-offline
node scripts/native-output.mjs write "$out/native/base" --checkout "$out/base"
node scripts/native-output.mjs write "$out/native/change"
node scripts/native-output.mjs diff "$out/native/base" "$out/native/change" --json > "$out/diff.json"
ROUTES=$(jq -r '.results[] | select(.missing or (.changes | length > 0) or ((.notes // []) | length > 0)) | .url' "$out/diff.json" | tr '\n' ' ')
echo "$ROUTES"
```

The native output does not cover the screens that throw in Node or never yield there, so add any
the change could affect first:

```sh
jq -r '(.results[] | select(.threw) | .url), (.skipped | keys[] | "/" + ltrimstr("/"))' "$out/diff.json"
ROUTES="$ROUTES /worklets"   # each of those the change could affect
```

Only then, with `ROUTES` still empty: nothing to compare, say so, clean up (step 6) and stop.

## 2. One app, both bundles

A Release simulator build of the canary carries its bundle and needs no Metro. One build serves
both sides when they share a native half:

```sh
(cd "$out/base/examples/canary" && node scripts/ios-app.mjs fingerprint)
(cd examples/canary && node scripts/ios-app.mjs fingerprint)
```

Different fingerprints: the change touches the native half, and each side needs a build of its own
(`pnpm release:ios` in each checkout, one native build at a time), copied to `$out/base.app` and
`$out/change.app`, where step 4 installs them from. Same: take any Release simulator
build of the canary with that fingerprint (`examples/canary/ios/build/Build/Products/Release-iphonesimulator/canary.app`
after a release build) and put each side's bundle into a copy of it. Each side bundles with a temp
dir of its own: Metro's and Expo's caches live there, and one side's cache sends the other's DOM
components to the wrong checkout.

```sh
app=/path/to/canary.app
(cd "$out/base/examples/canary" && TMPDIR=$(mktemp -d) node scripts/ios-app.mjs rebundle "$app" "$out/base.app")
(cd examples/canary && TMPDIR=$(mktemp -d) node scripts/ios-app.mjs rebundle "$app" "$out/change.app")
```

## 3. A simulator of its own

Never the one someone is using. The newest iPhone on the newest runtime, the status bar held
still:

```sh
read -r runtime type < <(xcrun simctl list devices available -j | jq -r '
  .devices | to_entries | map(select(.key | test("iOS"))) | sort_by(.key) | last
  | "\(.key) \(.value | map(select(.name | startswith("iPhone"))) | first | .deviceTypeIdentifier)"')
udid=$(xcrun simctl create screens-check "$type" "$runtime")
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b > /dev/null
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3
```

## 4. Each screen, on each side

For each side, base first: install its app, then open each route by link, answering iOS's "Open in
canary?" where it asks, and screenshot it once it has stopped changing. `idb` taps: `tap` finds an element by its accessibility label in
`idb ui describe-all` and taps its centre.

```sh
tap() { # label
  local frame x y
  frame=$(idb ui describe-all --udid "$udid" | jq -c --arg l "$1" 'first(.[] | select(.AXLabel == $l) | .frame)')
  [ -n "$frame" ] && [ "$frame" != null ] || { echo "no \"$1\" on screen" >&2; return 1; }
  read -r x y < <(jq -r '"\((.x + .width / 2) | floor) \((.y + .height / 2) | floor)"' <<< "$frame")
  idb ui tap --udid "$udid" "$x" "$y"
}

settle() { # file: screenshot into it until two a second apart are the same, at most twenty seconds
  local last= now
  for _ in $(seq 20); do
    sleep 1
    xcrun simctl io "$udid" screenshot "$1" 2> /dev/null
    now=$(md5 -q "$1")
    [ "$now" = "$last" ] && return
    last=$now
  done
}

shoot() { # side route [label to tap first]...
  local side=$1 route=$2 file
  shift 2
  file="$out/shots/$side/$(echo "${route#/}" $* | tr '/ ' '--' | sed 's/^-*//;s/^$/home/').png"
  xcrun simctl terminate "$udid" dev.angularnative.canary 2> /dev/null
  xcrun simctl openurl "$udid" "canary://${route#/}"
  sleep 3
  # iOS asks "Open in canary?" for a link simctl hands over, and asks again each time.
  if idb ui describe-all --udid "$udid" | jq -e '.[] | select(.AXLabel | startswith("Open in"))' > /dev/null; then
    tap Open
  fi
  settle "$file"
  [ $# -gt 0 ] || return 0
  # Taps on a screen that has stopped moving, then a screenshot two seconds on: what a tap shows
  # can go again by itself (a toast), so this one does not wait for the screen to settle.
  for label in "$@"; do tap "$label" && sleep 1; done
  sleep 1
  xcrun simctl io "$udid" screenshot "$file" 2> /dev/null
}

for side in base change; do
  mkdir -p "$out/shots/$side"
  xcrun simctl install "$udid" "$out/$side.app"
  for route in $(echo $ROUTES); do shoot "$side" "$route"; done
done
```

`ROUTES` is the list from step 1, space separated (`$(echo $ROUTES)` splits it in zsh as in bash).
A screen that never settles (a spinner, a looping animation) is taken at twenty seconds and will
differ for that alone.

What a screen shows after a tap (a sheet, a toast, a field's error) is a screenshot of its own:
`shoot base /overlays "Show a toast"` taps the button named "Show a toast" before the screenshot,
and the same on the change's side. `idb ui swipe --udid "$udid" x1 y1 x2 y2` swipes. Typing
(`idb ui text`) leaves the simulator thinking a hardware keyboard is attached, so the software
keyboard stops appearing: clear `AutomaticMinimizationEnabled` and `HardwareKeyboardLastSeen` in
`com.apple.keyboard.preferences` inside the simulator afterwards.

## 5. Compare

By pixels, not bytes: simctl does not encode the same screen to the same PNG twice. A BMP is the
pixels uncompressed. A pixel differs where any channel moves by more than 2 of 255, and a screen
is the same only where no pixel does. The tolerance is for iOS's Liquid Glass controls, such as
the header's back button, which shade by 1 between two launches of the same build; a real change
moves pixels by far more. There is no allowance for a count of pixels: a small icon that moved is a
few hundred, which a share of the screen would let through.

```sh
python3 - "$out" <<'PY'
import os, struct, subprocess, sys
out = sys.argv[1]
def pixels(png):
    subprocess.run(['sips', '-s', 'format', 'bmp', png, '--out', f'{out}/x.bmp'], capture_output=True)
    data = open(f'{out}/x.bmp', 'rb').read()
    offset = struct.unpack_from('<I', data, 10)[0]
    width, height = struct.unpack_from('<ii', data, 18)
    return data[offset:], width, abs(height)
for name in sorted(os.listdir(f'{out}/shots/base')):
    a, width, height = pixels(f'{out}/shots/base/{name}')
    b, *size = pixels(f'{out}/shots/change/{name}')
    if size != [width, height]:
        print(f'differs: {name} (size)')
        continue
    moved = [i // 4 for i in range(0, len(a), 4) if max(abs(a[i + k] - b[i + k]) for k in range(3)) > 2]
    if not moved:
        print(f'same: {name}')
        continue
    rows, xs = [p // width for p in moved], [p % width for p in moved]
    print(f'differs: {name}: {len(moved)} pixels, rows {min(rows)}-{max(rows)}, x {min(xs)}-{max(xs)}')
PY
```

For each that differs, shrink both (`sips -Z 900 <png> --out <smaller>`) and look at them side by
side. Say what changed, where on the screen, and whether it is what the change meant to do. A
difference in a spinner or a caret alone is noise: say so. The clock is frozen at 9:41 in step 3,
so a clock that differs means the override was skipped. Check that a screenshot is
of the screen named, not the home screen, a dialog or a red error screen.

## 6. Clean up

```sh
if [ -n "${udid:-}" ]; then xcrun simctl shutdown "$udid" 2> /dev/null; xcrun simctl delete "$udid"; fi
if [ -n "${out:-}" ]; then
  git worktree remove --force "$out/base" 2> /dev/null
  rm -rf "$out"
fi
```

Report each screen as same or differs, with what differs, and the screens not compared and why
(skipped in Node, a native half that changed, a screen that never settled).
