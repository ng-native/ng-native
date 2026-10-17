#!/usr/bin/env bash
# Compares the screenshots of two simulator builds of the canary, main's and a pull request's, on a
# simulator of its own: what every flow that asserts one shows on the first build is recorded, and
# then asserted on the second. See .maestro/ios/compare-builds.mjs.
#
#     examples/canary/scripts/visual-ios.sh <base.app> <change.app> <output dir>
#
# The output dir gets each screenshot that differs, main's beside the change's with the difference
# marked, and report.json, which screens-comment.yml writes the pull request comment from. It exits
# 0 whether or not a screenshot differs: a difference is for review. Anything else that stopped
# the comparison is in report.json as one not made, and exits 1.
#
# Maestro's driver not starting in time, or lost, on a busy CI Mac or a simulator booted for the
# first time, says nothing about the app: the comparison is made once more from the start then, after
# a reboot, as smoke-ios.sh walks its flow again.
set -uo pipefail

base=$1
change=$2
out=$3
here="$(dirname "$0")"
mkdir -p "$out"

source "$here/ios-simulator.sh" canary-visual
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}
# Out of the output dir, which holds only what the comment shows.
log=$(mktemp)

compare() {
  step "recording main's screenshots, then asserting them on the change"
  node "$here/../.maestro/ios/compare-builds.mjs" \
    --base "$base" --change "$change" --device "$udid" --out "$out" 2>&1 | tee "$log"
}
compare
lost='DeviceUnreachableException|IOSDriverTimeoutException|failed, code: 500, body: \)'
if ! grep -q '"compared": true' "$out/report.json" 2> /dev/null && grep -qE "$lost" "$log"; then
  echo "Maestro's driver did not start, or was lost, not the app: comparing again" >&2
  xcrun simctl shutdown "$udid" 2> /dev/null
  xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b | boot_phases || exit 1
  compare
fi
rm -f "$log"
# 1 is a screenshot that differs, or a comparison not made: report.json says which.
node -e '
  const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(report.compared ? 0 : 1);
' "$out/report.json"
