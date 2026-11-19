#!/usr/bin/env bash
# Succeeds when <dir> holds a Hermes build-hermes.sh finished for what the host is built for now
# (hermes-target.sh: the macOS, or off macOS the C library and the ICU); build.sh builds it again
# otherwise, so a raised target or a new ICU reaches Hermes too.
#
#   hermes-built.sh <dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:?usage: hermes-built.sh <dir>}"
[ -f "$dir/lib/libhermesvm_a.a" ] && [ -f "$dir/target" ] &&
  [ "$(cat "$dir/target")" = "$("$here/hermes-target.sh")" ]
