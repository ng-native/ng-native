#!/usr/bin/env bash
# Builds Hermes as a static library (hermesvm_a) against React Native's jsi, and its compiler
# (hermesc), into the cache.
#
#   build-hermes.sh <node_modules/react-native> [architectures, default: this Mac's]
#
# Release, debugger on, Intl on (as React Native's Apple builds are), HV32 heap. The flags follow
# Basalt's bootstrap.sh (Basalt 0.2.9, MIT, Copyright (c) 2026 Vince Vella), which mirrors React
# Native's own host build. jsi is not in the archive: the host compiles React Native's copy once.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RN_PKG="$(cd "${1:?usage: build-hermes.sh <node_modules/react-native> [architectures]}" && pwd)"
ARCHS="${2:-$(uname -m)}"
RN_VERSION="$(node -p "require('$RN_PKG/package.json').version")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"
JOBS="${NGN_JOBS:-8}"
OUT="$CACHE/hermes-${ARCHS//;/-}"

[ -d "$CACHE/src/hermes" ] || { echo "build-hermes.sh: run fetch.sh first" >&2; exit 1; }

intl=OFF
[ "$(uname -s)" = "Darwin" ] && intl=ON
cmake --log-level=ERROR -G Ninja -S "$CACHE/src/hermes" -B "$OUT" \
  -DJSI_DIR="$RN_PKG/ReactCommon/jsi" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$ARCHS" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DHERMES_ENABLE_DEBUGGER=ON \
  -DHERMES_ENABLE_INTL="$intl" \
  -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32 \
  -DHERMES_ENABLE_TEST_SUITE=OFF \
  -DHERMES_BUILD_APPLE_FRAMEWORK=OFF \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
# hermesc too, which compiles a packaged app's bundle to this Hermes's bytecode.
nice -n 10 cmake --build "$OUT" --target hermesvm_a hermesc -j "$JOBS"
echo "$OUT"
