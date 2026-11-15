#!/usr/bin/env bash
# Prints the oldest macOS the host runs on: CMakeLists.txt's CMAKE_OSX_DEPLOYMENT_TARGET, which
# build-hermes.sh builds Hermes for too (bin/package.mjs MINIMUM_MACOS is the packaged app's).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="$(sed -n 's/^set(CMAKE_OSX_DEPLOYMENT_TARGET \([0-9.]*\))$/\1/p' "$here/../CMakeLists.txt")"
[ -n "$target" ] || { echo "macos-target.sh: no CMAKE_OSX_DEPLOYMENT_TARGET in CMakeLists.txt" >&2; exit 1; }
echo "$target"
