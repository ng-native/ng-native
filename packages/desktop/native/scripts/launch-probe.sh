#!/usr/bin/env bash
# Launches a built host on a bundle file and checks that it starts: the app commits and the host
# draws its first frame, then it keeps running for a moment. Fails on a crash or an exit before
# then, an uncaught JavaScript error, or no first frame in time. Prints the host's log either way.
#
#   launch-probe.sh <ngn-macos or ngn-linux> <bundle.js> [seconds, default 60]
#
# A test launch (NGN_TESTS=1): the host keeps its state in a new directory, takes no focus and
# shows no system prompt, so the probe leaves nothing behind on the machine it runs on.
set -euo pipefail
host="${1:?usage: launch-probe.sh <host> <bundle.js> [seconds]}"
bundle="${2:?usage: launch-probe.sh <host> <bundle.js> [seconds]}"
limit="${3:-60}"

work="$(mktemp -d)"
log="$work/host.log"
pid=""
cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2> /dev/null; then
    kill "$pid" 2> /dev/null || true
    wait "$pid" 2> /dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir "$work/state"
NGN_TESTS=1 NGN_STATE_DIR="$work/state" NGN_RUN_ID="probe-$$" NGN_TESTS_FAKE_SYSTEM_UI=1 NGN_LOG_COMMITS=1 \
  "$host" "$bundle" --title "Launch probe" > "$log" 2>&1 &
pid=$!

fail() {
  echo "launch-probe: $1" >&2
  echo "--- host log ---" >&2
  cat "$log" >&2
  exit 1
}

# An uncaught error reaches React Native's default error handler, which logs it; console.error logs
# at level 3.
js_error() {
  grep -qE '\[onJsError called\]|\[js:3\]' "$log"
}

start=$(date +%s)
while ! grep -q '^\[ngn\] first frame' "$log"; do
  kill -0 "$pid" 2> /dev/null || { wait "$pid" && status=0 || status=$?; fail "the host exited ($status) before its first frame"; }
  js_error && fail "a JavaScript error before the first frame"
  [ $(($(date +%s) - start)) -lt "$limit" ] || fail "no first frame within ${limit}s"
  sleep 0.2
done
grep -q '^\[ngn\] commit' "$log" || fail "the first frame came with no commit"

# Still running a moment after the first frame: a crash in the commits that follow fails too.
sleep 3
kill -0 "$pid" 2> /dev/null || { wait "$pid" && status=0 || status=$?; fail "the host exited ($status) after its first frame"; }
js_error && fail "a JavaScript error after the first frame"

cat "$log"
echo "launch-probe: $(grep '^\[ngn\] first frame' "$log"), $(grep -c '^\[ngn\] commit' "$log") commits"
