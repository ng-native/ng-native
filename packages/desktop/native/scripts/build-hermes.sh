#!/usr/bin/env bash
# Builds Hermes as a static library (hermesvm_a) against React Native's jsi, and its compiler
# (hermesc), into the cache.
#
#   build-hermes.sh <node_modules/react-native> [architectures, default: this Mac's]
#
# Release, debugger on, HV32 heap. Intl on macOS (as React Native's Apple builds are), over
# Foundation; elsewhere Intl is off, and the Unicode layer links the static ICU build-icu.sh builds
# into <out>/icu, which cmake/runtime-dependencies.cmake links the host against. The flags follow
# Basalt's bootstrap.sh (Basalt 0.2.9, MIT, Copyright (c) 2026 Vince Vella), which mirrors React
# Native's own host build. jsi is not in the archive: the host compiles React Native's copy once.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RN_PKG="$(cd "${1:?usage: build-hermes.sh <node_modules/react-native> [architectures]}" && pwd)"
ARCHS="${2:-$(uname -m)}"
RN_VERSION="$(node -p 'require(process.argv[1] + "/package.json").version' "$RN_PKG")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"
JOBS="${NGN_JOBS:-8}"
OUT="$CACHE/hermes-${ARCHS//;/-}"
MACOS_TARGET="$("$here/macos-target.sh")"
TARGET="$("$here/hermes-target.sh")"

[ -d "$CACHE/src/hermes" ] || { echo "build-hermes.sh: run fetch.sh first" >&2; exit 1; }
# Unfinished until the stamp is written again at the end.
rm -f "$OUT/target"

intl=OFF
icu_args=()
if [ "$(uname -s)" = "Darwin" ]; then
  intl=ON
else
  "$here/build-icu.sh" "$CACHE" "$OUT/icu"
  icu_args=(-DHERMES_USE_STATIC_ICU=ON -DICU_ROOT="$OUT/icu")
fi
launcher_args=()
while IFS= read -r arg; do
  launcher_args+=("$arg")
done < <("$here/compiler-launcher.sh" "${NGN_COMPILER_LAUNCHER:-}")
cmake --log-level=ERROR -G Ninja -S "$CACHE/src/hermes" -B "$OUT" \
  -DJSI_DIR="$RN_PKG/ReactCommon/jsi" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$ARCHS" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_TARGET" \
  -DHERMES_ENABLE_DEBUGGER=ON \
  -DHERMES_ENABLE_INTL="$intl" \
  -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32 \
  -DHERMES_ENABLE_TEST_SUITE=OFF \
  -DHERMES_BUILD_APPLE_FRAMEWORK=OFF \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  ${launcher_args[@]+"${launcher_args[@]}"} \
  ${icu_args[@]+"${icu_args[@]}"}
# hermesc too, which compiles a packaged app's bundle to this Hermes's bytecode.
nice -n 10 cmake --build "$OUT" --target hermesvm_a hermesc -j "$JOBS"
# What hermes-built.sh checks: what this build is for (hermes-target.sh).
echo "$TARGET" > "$OUT/target"
echo "$OUT"
