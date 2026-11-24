#!/usr/bin/env bash
# Waits for the Mac's 1-minute load average to fall below a threshold, for at most a cap, and says
# what it waited for.
#
#     examples/canary/scripts/wait-for-load.sh [threshold] [cap seconds]
#
# A simulator's first boot on a CI Mac is followed by minutes of one-time setup inside it (widget
# extensions, Calendar, Health, Safari's bookmark sync), which drives the 3-CPU runner's load from
# about 40 to over 500. An app launched into that has missed Metro, timed out its first test, and
# dropped a Maestro tap. So the device tests and the smoke flows wait here after the boot. A calm
# machine is under the threshold at the first reading and does not wait; a busy one goes on after
# the cap, since a slow run is better than none. Always exits 0.
set -uo pipefail

threshold=${1:-${LOAD_THRESHOLD:-100}}
cap=${2:-${LOAD_WAIT_CAP:-180}}
every=5

# `{ 44.20 31.30 13.58 }`: the 1-minute average is the second field.
load() { sysctl -n vm.loadavg 2> /dev/null | awk '{ print $2 }'; }
below() { awk -v load="$1" -v threshold="$threshold" 'BEGIN { exit !(load < threshold) }'; }

started=$SECONDS
first=$(load)
if [ -z "$first" ]; then
  echo "wait-for-load: could not read the load average; not waiting"
  exit 0
fi
current=$first
while ! below "$current"; do
  waited=$((SECONDS - started))
  if [ "$waited" -ge "$cap" ]; then
    echo "wait-for-load: load $current is still not under $threshold after ${waited}s (it was $first); going on"
    exit 0
  fi
  echo "wait-for-load: load $current, waiting for it to fall under $threshold (${waited}s of ${cap}s)"
  sleep "$every"
  current=$(load)
  [ -n "$current" ] || current=$first
done
echo "wait-for-load: load $current is under $threshold after $((SECONDS - started))s (it was $first)"
