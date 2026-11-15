#!/usr/bin/env bash
# Succeeds when <dir> holds a Hermes build-hermes.sh finished for the macOS the host is built for
# now (macos-target.sh); build.sh builds it again otherwise, so a raised target reaches Hermes too.
#
#   hermes-built.sh <dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:?usage: hermes-built.sh <dir>}"
[ -f "$dir/lib/libhermesvm_a.a" ] && [ -f "$dir/macos-target" ] &&
  [ "$(cat "$dir/macos-target")" = "$("$here/macos-target.sh")" ]
