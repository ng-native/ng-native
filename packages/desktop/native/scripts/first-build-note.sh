#!/usr/bin/env bash
# Prints NGN_FIRST_BUILD_NOTE, how long a first build of the host takes, to stderr when the build
# directory build.sh is about to use has never been configured. Each install of the package, and
# each app that links native code of its own, builds in a directory of its own (host-dir.sh), so
# another app's build in the same cache says nothing about this one's.
#
#   first-build-note.sh <build dir>
set -euo pipefail
build="${1:?usage: first-build-note.sh <build dir>}"
if [ -n "${NGN_FIRST_BUILD_NOTE:-}" ] && [ ! -f "$build/build.ninja" ]; then
  printf '%s\n' "$NGN_FIRST_BUILD_NOTE" >&2
fi
