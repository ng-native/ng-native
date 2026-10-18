---
name: screens-check
description: Compare how a change draws the canary's screens on iOS against main - the screens whose native output changed, each opened by deep link on one simulator in main's bundle and in the change's, screenshotted with simctl and compared pair by pair. Use for a change that draws (the CSS engine, components, layout, text), when asked to check a pull request's screens, or when the PR gate's native output lists changed screens.
---

# Check a change's screens

`node scripts/pr-gate.mjs` says which screens' native output changed. This skill shows what that
looks like: each of those screens, main beside the change, on one simulator in one sitting, so a
difference is the change and not a runtime or a day.

Run everything from the repository root. Keep the simulator and the base worktree for the whole
run, and remove both at the end, whatever happened.

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
jq -r '.results[] | select(.missing or (.changes | length > 0) or ((.notes // []) | length > 0)) | .url' "$out/diff.json"
```

No route listed: nothing to compare, say so and stop. The screens `diff.json` lists under
`skipped` (they throw or never yield in Node) are not covered by the native output: add any the
change could affect by hand.

## 2. One app, both bundles

A Release simulator build of the canary carries its bundle and needs no Metro. One build serves
both sides when they share a native half:

```sh
(cd "$out/base/examples/canary" && node scripts/ios-app.mjs fingerprint)
(cd examples/canary && node scripts/ios-app.mjs fingerprint)
```

Different fingerprints: the change touches the native half, and each side needs a build of its own
(`pnpm release:ios` in each checkout, one native build at a time). Same: take any Release simulator
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

For each side, base first: install its app, answer iOS's "Open in canary?" once (a simulator asks
the first time an app is handed a link of its scheme), then open each route by link and screenshot
it once it has stopped changing.

```sh
cat > "$out/allow.yaml" <<'EOF'
appId: dev.angularnative.canary
---
- openLink: canary://
- runFlow:
    when:
      visible: Open
    commands:
      - tapOn: Open
EOF

shoot() { # side route
  local file="$out/shots/$1/$(echo "${2#/}" | tr / - | sed 's/^$/home/').png" last=
  xcrun simctl terminate "$udid" dev.angularnative.canary 2> /dev/null
  xcrun simctl openurl "$udid" "canary://${2#/}"
  # Until two screenshots a second apart are the same, for at most twenty seconds.
  for _ in $(seq 20); do
    sleep 1
    xcrun simctl io "$udid" screenshot "$file" 2> /dev/null
    now=$(md5 -q "$file")
    [ "$now" = "$last" ] && break
    last=$now
  done
}

for side in base change; do
  mkdir -p "$out/shots/$side"
  xcrun simctl install "$udid" "$out/$side.app"
  JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21} maestro --device "$udid" test "$out/allow.yaml"
  for route in $(echo $ROUTES); do shoot "$side" "$route"; done
done
```

`ROUTES` is the list from step 1, space separated (`$(echo $ROUTES)` splits it in zsh as in bash). A screen that never settles (a spinner, a
looping animation) is taken at twenty seconds and will differ for that alone.

## 5. Compare

By pixels, not bytes: simctl does not encode the same screen to the same PNG twice. A BMP is the
pixels uncompressed, so the bytes that differ between two of them are the pixels that do. Under
0.01% of them is noise (antialiasing, the status bar) and the same screen:

```sh
for file in "$out"/shots/base/*.png; do
  name=$(basename "$file" .png)
  sips -s format bmp "$file" --out "$out/a.bmp" > /dev/null
  sips -s format bmp "$out/shots/change/$name.png" --out "$out/b.bmp" > /dev/null
  differ=$(cmp -l "$out/a.bmp" "$out/b.bmp" | wc -l | tr -d ' ')
  total=$(stat -f %z "$out/a.bmp")
  if [ "$differ" -lt $((total / 10000)) ]; then echo "same: $name"; else echo "differs: $name ($differ of $total bytes)"; fi
done
```

For each that differs, shrink both (`sips -Z 900 <png> --out <smaller>`) and look at them side by
side. Say what changed, where on the screen, and whether it is what the change meant to do. A
difference in a spinner, a caret or the clock alone is noise: say so. Check that a screenshot is
of the screen named, not the home screen, a dialog or a red error screen.

## 6. Clean up

```sh
xcrun simctl shutdown "$udid"; xcrun simctl delete "$udid"
git worktree remove --force "$out/base"
rm -rf "$out"
```

Report each screen as same or differs, with what differs, and the screens not compared and why
(skipped in Node, a native half that changed, a screen that never settled).
