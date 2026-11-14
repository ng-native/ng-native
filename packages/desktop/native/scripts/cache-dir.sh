#!/usr/bin/env bash
# Prints the per-user build cache for one React Native version:
#
#   macOS  ~/Library/Caches/ng-native/desktop/rn-<version>
#   Linux  ${XDG_CACHE_HOME:-~/.cache}/ng-native/desktop/rn-<version>
#
# NGN_DESKTOP_CACHE replaces the part before rn-<version> (CI points it at a cached directory).
# bin/cache-dir.mjs computes the same path for the ng-native-desktop bin; keep the two in step.
set -euo pipefail
version="${1:?usage: cache-dir.sh <react-native version>}"
if [ -n "${NGN_DESKTOP_CACHE:-}" ]; then
  root="$NGN_DESKTOP_CACHE"
elif [ "$(uname -s)" = "Darwin" ]; then
  root="$HOME/Library/Caches/ng-native/desktop"
else
  root="${XDG_CACHE_HOME:-$HOME/.cache}/ng-native/desktop"
fi
echo "$root/rn-$version"
