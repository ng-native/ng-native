#!/usr/bin/env bash
# Starts Xvfb on display :99 in the background, with its output in <log>, and returns once it takes
# connections, printing its PID for the caller to stop:
#
#   xvfb=$(native/scripts/start-xvfb.sh "$out/xvfb.log")
#   trap "kill $xvfb" EXIT
#
# Xvfb writes the display's number to -displayfd once it listens. Fails, printing the log, when Xvfb
# exits first or has not written it within [seconds] (20 by default).
set -euo pipefail

log="$1"
seconds="${2:-20}"
ready=$(mktemp)
trap 'rm -f "$ready"' EXIT

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -displayfd 3 3> "$ready" > "$log" 2>&1 &
pid=$!

why="did not take connections within ${seconds}s"
for _ in $(seq $((seconds * 5))); do
  if [ -s "$ready" ]; then
    echo "$pid"
    exit 0
  fi
  if ! kill -0 "$pid" 2> /dev/null; then
    why="exited before it took connections"
    break
  fi
  sleep 0.2
done
kill "$pid" 2> /dev/null || true
echo "start-xvfb: Xvfb on :99 $why" >&2
cat "$log" >&2
exit 1
