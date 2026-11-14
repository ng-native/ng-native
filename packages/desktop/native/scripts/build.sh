#!/usr/bin/env bash
# Builds the desktop host (or only the core and its tests) in the per-user cache, fetching the
# pinned sources and building Hermes first when they are missing. Prints the build directory.
#
#   build.sh <node_modules/react-native> [--backend appkit|none] [--universal] [--debug] [--test]
#
#   --backend none  the toolkit-free core and its tests only: any OS, no Hermes
#   --universal     arm64 and x86_64 in one binary (default: this machine's architecture)
#   --debug         a Debug build (default: RelWithDebInfo)
#   --test          run the core tests after building
#
# NGN_JOBS caps parallel compiles (default 8).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RN_PKG="$(cd "${1:?usage: build.sh <node_modules/react-native> [options]}" && pwd)"
shift
backend=none
[ "$(uname -s)" = "Darwin" ] && backend=appkit
archs="$(uname -m)"
config=RelWithDebInfo
run_tests=0
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) backend="$2"; shift ;;
    --universal) archs="arm64;x86_64" ;;
    --debug) config=Debug ;;
    --test) run_tests=1 ;;
    *) echo "build.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
# CMAKE_OSX_ARCHITECTURES means nothing off macOS.
[ "$(uname -s)" = "Darwin" ] || archs=""

JOBS="${NGN_JOBS:-8}"
RN_VERSION="$(node -p "require('$RN_PKG/package.json').version")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"

"$here/fetch.sh" "$RN_PKG" >&2

arch_key="${archs//;/-}"
hermes_args=()
if [ "$backend" != "none" ]; then
  hermes="$CACHE/hermes-$arch_key"
  if [ ! -f "$hermes/lib/libhermesvm_a.a" ]; then
    "$here/build-hermes.sh" "$RN_PKG" "$archs" >&2
  fi
  hermes_args=(-DNGN_HERMES_BUILD="$hermes")
fi

BUILD="$CACHE/host/$backend-${arch_key:-native}-$config"
cmake --log-level=WARNING -G Ninja -S "$here/.." -B "$BUILD" \
  -DCMAKE_BUILD_TYPE="$config" \
  -DCMAKE_OSX_ARCHITECTURES="$archs" \
  -DNGN_BACKEND="$backend" \
  -DRN_DIR="$RN_PKG" \
  -DNGN_SOURCES="$CACHE/src" \
  ${hermes_args[@]+"${hermes_args[@]}"} >&2
nice -n 10 cmake --build "$BUILD" -j "$JOBS" >&2
if [ "$run_tests" = 1 ]; then
  "$BUILD/ngn_core_tests" >&2
fi
echo "$BUILD"
