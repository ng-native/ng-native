#!/usr/bin/env bash
# What CI starts while the canary builds, which is minutes on its Mac and nothing to do with the
# app: a simulator's first boot, and Maestro's driver installed on it and started. The simulator is
# kept for ios-tests.sh, which gets it in `UDID`.
#
#     examples/canary/scripts/ios-warm.sh <udid file>
#
# Writes the simulator's udid to the file once it has booted, and <udid file>.done when it is all
# done, which is when what waits on it can go on, whether or not the driver started.
set -uo pipefail

file=$1
trap 'touch "$file.done"' EXIT
KEEP_SIMULATOR=1 source "$(dirname "$0")/ios-simulator.sh" canary-ci
echo "$udid" > "$file"
step "starting Maestro's driver"
flow=$(mktemp -t warm).yaml
printf 'appId: com.apple.Preferences\n---\n- launchApp\n' > "$flow"
maestro --device "$udid" test --no-ansi "$flow"
step "the simulator is ready"
