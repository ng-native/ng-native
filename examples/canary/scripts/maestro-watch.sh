#!/usr/bin/env bash
# Runs a Maestro command, printing and logging its output, and ends it when Maestro itself fails.
#
#     examples/canary/scripts/maestro-watch.sh <log> <seconds> -- <command...>
#
# Maestro's CLI can throw on its main thread and keep running: an iOS XCTest driver that answers a
# request with a 500 ("Request for terminateApp failed, code: 500, body: ") prints
# `Exception in thread "main"` and the process stays up, so a CI job waited out its whole timeout
# on it. This ends the command as soon as that line is printed, exiting 70, and after <seconds>
# whatever it prints, exiting 124. Otherwise it exits as the command does. <log> is appended to.
set -uo pipefail

log=$1
limit=$2
shift 3
touch "$log"
from=$(($(wc -c < "$log") + 1))

# Its own process group, so ending it ends the JVM Maestro starts and anything that starts too.
perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!\n"' "$@" > >(tee -a "$log") 2>&1 &
pid=$!

stop() {
  kill -TERM -- "-$pid" 2>/dev/null
  sleep 2
  kill -KILL -- "-$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

started=$SECONDS
while kill -0 "$pid" 2>/dev/null; do
  if tail -c "+$from" "$log" | grep -q 'Exception in thread "main"'; then
    echo "[$(date +%T)] Maestro threw on its main thread and kept running: ending it" >&2
    stop
    exit 70
  fi
  if ((SECONDS - started >= limit)); then
    echo "[$(date +%T)] Maestro ran past ${limit}s: ending it" >&2
    stop
    exit 124
  fi
  sleep 1
done
wait "$pid"
