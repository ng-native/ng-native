#!/usr/bin/env bash
# Installs a canary APK on the booted emulator and runs the release smoke flow against it.
#
#     examples/canary/scripts/smoke-android.sh <apk> <output dir>
#
# CI runs this inside the emulator step, which runs each line of its script as a shell of its own,
# so the sequence lives here. The output dir gets Maestro's screenshots and logs, and the device
# log, which is where a release build's crash at startup is written.
set -uo pipefail

apk=$1
out=$2
flows="$(dirname "$0")/../.maestro/release"

mkdir -p "$out"
# A slow emulator's own apps go unresponsive, and Android covers the screen with "Pixel Launcher
# isn't responding", which hides a canary that rendered. With error dialogs hidden, Android closes
# the app instead. A canary that hangs or crashes still fails the flow, by what it no longer shows.
adb shell settings put global hide_error_dialogs 1
adb install -r "$apk" || exit 1
# One flow at a time, without ANSI: given a directory, Maestro prints nothing until every flow has
# finished, where given a file it prints each command as it runs. A failing flow stops the walk,
# so the logs left in the output dir are its own.
status=0
for flow in "$flows"/*.yaml; do
  echo "[$(date +%T)] walking $(basename "$flow")"
  maestro test --no-ansi "$flow" --test-output-dir "$out" --debug-output "$out" \
    --flatten-debug-output || { status=$?; break; }
done
adb logcat -d > "$out/logcat.txt"
exit "$status"
