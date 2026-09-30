#!/usr/bin/env bash
# Creates a simulator for the release smoke flow, starts it booting, and prints its UDID without
# waiting for the boot to finish.
#
#     examples/canary/scripts/boot-ios-simulator.sh
#
# A fresh simulator takes minutes to boot on a CI Mac, so CI starts one before the build and hands
# its UDID to smoke-ios.sh in CANARY_SIMULATOR; the boot then runs while the app is built, and
# smoke-ios.sh waits for whatever is left. The device is the newest iOS runtime's first iPhone:
# every runtime ships a set of devices made for it.
set -uo pipefail

read -r runtime type < <(xcrun simctl list devices available -j | jq -r '
  .devices | to_entries | map(select(.key | test("iOS"))) | sort_by(.key) | last
  | "\(.key) \(.value | map(select(.name | startswith("iPhone"))) | first | .deviceTypeIdentifier)"')
if [ -z "${runtime:-}" ] || [ -z "${type:-}" ] || [ "$type" = null ]; then
  echo "No iOS runtime with an iPhone simulator found (or jq is missing): see xcrun simctl list" >&2
  exit 1
fi
udid=$(xcrun simctl create canary-smoke "$type" "$runtime") || exit 1
# In the background, and writing nowhere: a caller capturing the UDID would otherwise wait for it.
xcrun simctl boot "$udid" >/dev/null 2>&1 &
echo "$udid"
