#!/usr/bin/env bash
# Everything CI does with the canary's iOS app on one simulator, so the boot and Maestro's driver
# start, minutes each on CI's Mac, are paid once: the release smoke flow, then the screenshots.
#
#     examples/canary/scripts/ios-tests.sh <canary.app> <output dir>
#
# What it does with the screenshots is set by the environment:
#
#   RECORD_INTO   a directory: every flow's screenshots are recorded into it, as main's, to cache
#   FLOWS         the flows to compare, comma separated (see compare-builds.mjs flows); none, and
#                 no screen's native output changed, so nothing is compared
#   BASE_SHOTS    main's screenshots, recorded before and cached, to compare FLOWS with
#   BASE_APP      main's app, where BASE_SHOTS is not there: its screenshots are recorded here first
#
# The output dir gets the smoke flow's logs in maestro/, and the comparison in screens/: each
# screenshot that differs and report.json, which screens-comment.yml writes the comment from. It
# exits with the smoke flow's status: a difference is for review, and report.json says whether the
# screenshots were compared.
set -uo pipefail

app=$1
out=$2
here="$(dirname "$0")"
compare="$here/../.maestro/ios/compare-builds.mjs"
mkdir -p "$out/screens"

source "$here/ios-simulator.sh" canary-ci
# The driver's first start on a fresh CI simulator has taken past three minutes, and a start that
# times out costs a reboot and the whole walk again: given six, it finishes the first time.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-360000}

UDID=$udid "$here/smoke-ios.sh" "$app" "$out/maestro"
smoke=$?

report() { echo "$1" > "$out/screens/report.json"; }
# Maestro's driver lost, not the app, is retried once from the start, as smoke-ios.sh retries it.
lost='DeviceUnreachableException|IOSDriverTimeoutException|failed, code: 500, body: \)'
screens() {
  local log
  log=$(mktemp)
  node "$compare" "$@" --device "$udid" 2>&1 | tee "$log"
  if [ "${PIPESTATUS[0]}" -ne 0 ] && grep -qE "$lost" "$log"; then
    echo "Maestro's driver did not start, or was lost, not the app: running again" >&2
    xcrun simctl shutdown "$udid" 2> /dev/null
    xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b | boot_phases
    node "$compare" "$@" --device "$udid"
  fi
  rm -f "$log"
}

if [ -n "${RECORD_INTO:-}" ]; then
  step "recording every flow's screenshots"
  screens record --app "$app" --into "$RECORD_INTO"
elif [ -z "${FLOWS:-}" ]; then
  # The flows are chosen by what changed: none is no screen's native output changing.
  report '{"flows":0,"compared":true,"differ":[],"unchanged":true}'
elif [ -n "${BASE_SHOTS:-}" ] && [ -d "$BASE_SHOTS" ]; then
  step "comparing the screenshots of $FLOWS with main's"
  screens assert --app "$app" --from "$BASE_SHOTS" --flows "$FLOWS" --out "$out/screens"
elif [ -n "${BASE_APP:-}" ] && [ -d "$BASE_APP" ]; then
  step "recording main's screenshots of $FLOWS, then comparing"
  screens compare --base "$BASE_APP" --change "$app" --flows "$FLOWS" --out "$out/screens"
else
  report '{"skipped":"the change touches the native half, and no app of the base'"'"'s is cached"}'
fi
# A comparison stopped before it wrote its report compared nothing, and says so.
[ -f "$out/screens/report.json" ] || [ -n "${RECORD_INTO:-}" ] \
  || report '{"flows":0,"compared":false,"differ":[]}'
exit "$smoke"
