#!/usr/bin/env bash
# Installs a canary simulator build on a simulator of its own and runs the release smoke flow
# against it.
#
#     examples/canary/scripts/smoke-ios.sh <canary.app> <output dir>
#
# The iOS twin of smoke-android.sh. The app is a Release build for the simulator, which carries
# its bundle and needs no Metro. The simulator is created here, from the newest iPhone and iOS
# runtime installed, and deleted afterwards, so a run never meets another app's state or a
# simulator someone else is using. The output dir gets Maestro's screenshots and logs, and the
# app's log on a failure, which is where a release build's crash at startup is written.
set -uo pipefail

app=$1
out=$2
flows="$(dirname "$0")/../.maestro/release"
mkdir -p "$out"

source "$(dirname "$0")/ios-simulator.sh" canary-smoke
step "installing the app"
xcrun simctl install "$udid" "$app" || exit 1
# Maestro drives the simulator through an XCTest runner of its own, which a loaded CI Mac has
# been slow to start and has lost mid-flow. Both say nothing about the app, which a crash would
# fail by what it no longer shows: so the runner gets longer to start, and when it did not start
# or was lost, the flow is walked once more from the start. So is a link that `simctl openurl` gave
# up on (ETIMEDOUT, NSPOSIX 60): a starved simulator has timed one out that reached the app a second
# later, and Maestro fails a flow on it outright, past any `retry` or `optional`. So is a driver
# that answers with an empty 500. Its console is kept, since the startup failure is reported there
# and not in maestro.log.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}
# Maestro can throw on its main thread and keep running, which a job then waits out to its
# timeout: the watch ends it then, and a walk that runs past this many seconds. A passing walk,
# the driver's start included, takes under ten minutes; two of these and a reboot fit in the job.
watch="$(dirname "$0")/maestro-watch.sh"
flow_limit=${SMOKE_FLOW_LIMIT:-720}
# One flow at a time, without ANSI: given a directory, Maestro prints nothing until every flow has
# finished, where given a file it prints each command as it runs. A failing flow stops the walk,
# so the logs left in the output dir are its own.
walk() {
  local flow code
  mkdir -p "$1"
  : > "$1/console.log"
  for flow in "$flows"/*.yaml; do
    step "walking $(basename "$flow"); Maestro's driver takes a minute or two to start"
    "$watch" "$1/console.log" "$flow_limit" -- maestro --device "$udid" test --no-ansi "$flow" \
      --test-output-dir "$1" --debug-output "$1" --flatten-debug-output
    code=$?
    [ "$code" -eq 0 ] || return "$code"
  done
}
walk "$out"
status=$?
# The XCTest driver answering a request with an empty 500, "Request for terminateApp failed, code:
# 500, body: ", is the driver failing, before the app is asked anything.
lost='DeviceUnreachableException|IOSDriverTimeoutException|domain=NSPOSIXErrorDomain, code=60|failed, code: 500, body: \)'
if [ "$status" -ne 0 ] && grep -qE "$lost" "$out/console.log" "$out/maestro.log" 2>/dev/null; then
  echo "Maestro lost its driver or simctl timed out opening a link, not the app: walking the flow again" >&2
  # A reboot clears what the lost walk left on screen: a link's "Open in canary?" dialog stays up
  # over the relaunched app and hides it. Shutdown fails on a simulator already shut down, so it
  # runs only on a booted one.
  if xcrun simctl list devices "$udid" | grep -q '(Booted)'; then
    xcrun simctl shutdown "$udid" || exit 1
  fi
  xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b | boot_phases || exit 1
  walk "$out/retry"
  status=$?
fi
# Only on a failure, which is the only time the output dir is uploaded: reading the log takes
# over a minute.
if [ "$status" -ne 0 ]; then
  step "saving the app's log"
  xcrun simctl spawn "$udid" log show --last 15m --style compact \
    --predicate 'process == "canary"' > "$out/canary.log" 2>&1
fi
exit "$status"
