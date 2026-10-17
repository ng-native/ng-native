#!/usr/bin/env bash
# Records the committed screenshot baselines from a simulator build of the canary, on a simulator
# of its own, as update-screenshots.yml does for a pull request. See .maestro/ios/record-baselines.mjs.
#
#     examples/canary/scripts/record-ios.sh <canary.app>
set -uo pipefail

app=$1
here="$(dirname "$0")"

source "$here/ios-simulator.sh" canary-record
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}

step "installing the app"
xcrun simctl install "$udid" "$app" || exit 1
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --wifiBars 3 || exit 1
step "recording the baselines"
MAESTRO_DEVICE=$udid node "$here/../.maestro/ios/record-baselines.mjs"
