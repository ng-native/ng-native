#!/usr/bin/env bash
# Removes the host build directories whose sources are gone:
#
#   prune-hosts.sh <cache root>
#
# host-dir.sh names a directory for each install of the native sources, so every upgrade, patch,
# worktree or project leaves one behind, a full build each. In each React Native version's cache,
# rn-*, so an upgrade's earlier one too, a host/build-* goes once the native source folder its
# CMake caches were configured from no longer exists, and an app-* once the app its `app` file
# names does. One with nothing recorded yet, being configured for the first time, stays.
set -euo pipefail
root="${1:?usage: prune-hosts.sh <cache root>}"
for dir in "$root"/rn-*/host/build-* "$root"/rn-*/host/app-*; do
  [ -d "$dir" ] || continue
  case "${dir##*/}" in
    app-*) sources="$(cat "$dir/app" 2>/dev/null || true)" ;;
    *) sources="$(sed -n 's/^CMAKE_HOME_DIRECTORY:INTERNAL=//p' "$dir"/*/CMakeCache.txt 2>/dev/null || true)" ;;
  esac
  [ -n "$sources" ] || continue
  gone=1
  while IFS= read -r source; do
    [ -d "$source" ] && gone=0
  done <<< "$sources"
  if [ "$gone" = 1 ]; then
    echo "build.sh: removing ${dir##*/}, whose sources are gone" >&2
    rm -rf "$dir"
  fi
done
