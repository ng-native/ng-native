#!/usr/bin/env bash
# Fetches the sources the desktop host builds from into the per-user cache, each at a pinned
# commit or checksum, and generates React Native's component codegen.
#
#   fetch.sh <node_modules/react-native>
#
# ReactCommon comes from the installed react-native package; everything else is fetched here:
# ReactCxxPlatform (in the git tag, not the npm package), Hermes, folly and the libraries React
# Native's Android build would normally download (glog, fmt, double-conversion, boost headers,
# fast_float), nlohmann_json for the dev-server client, and doctest for the core tests.
# Each source records what it was fetched at, so a changed pin fetches it again. A download whose
# checksum or commit does not match fails the script; nothing is ever used unverified.
#
# The approach (a sparse clone of the React Native tag, codegen run with -t android) follows
# Basalt's bootstrap.sh (Basalt 0.2.9, MIT, Copyright (c) 2026 Vince Vella); the script is ours.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
RN_PKG="$(cd "${1:?usage: fetch.sh <node_modules/react-native>}" && pwd)"
RN_VERSION="$(node -p "require('$RN_PKG/package.json').version")"

# --- Pins, per supported React Native version ----------------------------------------------------
# One React Native minor per release (the template's Expo SDK). Add a block to support another.
case "$RN_VERSION" in
  0.88.0)
    RN_SHA=5c35c82cf7dd322bf94d47501508c3de975c077b
    HERMES_TAG=hermes-v260318099.0.2
    HERMES_SHA=4188b63f24026ca62b79dc81d95db122a59c6089
    ;;
  *)
    echo "fetch.sh: react-native $RN_VERSION is not supported; this release builds against 0.88.0." >&2
    exit 1
    ;;
esac
# The versions React Native's gradle/libs.versions.toml pins, except glog (0.7.1 builds with
# CMake on every OS; React Native's 0.3.5 needs Android's prepared config headers) and
# double-conversion (3.3.1, the same API under the upstream repository's current layout).
FOLLY_SHA=0660ead5b610047a279cc291129e98e3f2a1fc37         # v2024.11.18.00
FAST_FLOAT_SHA=77cc847c842c49e7e3477c1e95da2b6540166d66    # v8.0.0
GLOG_SHA=7b134a5c82c0c0b5698bb6bf7a835b230c5638e4          # v0.7.1
FMT_SHA=407c905e45ad75fc29bf0f9bb7c5c2fd3475976f           # 12.1.0
DOUBLE_CONVERSION_SHA=ae0dbfeb9744efd216c95b30555049d75d47116a # v3.3.1
BOOST_URL=https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.bz2
BOOST_SHA256=6478edfe2f3305127cffe8caf73ea0176c53769f4bf1585be237eb30798c3b8e
NLOHMANN_URL=https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp
NLOHMANN_SHA256=9bea4c8066ef4a1c206b2be5a36302f8926f7fdc6087af5d20b417d0cf103ea6
DOCTEST_URL=https://raw.githubusercontent.com/doctest/doctest/v2.4.12/doctest/doctest.h
DOCTEST_SHA256=94029a7d32da24a56249658147dbd2b33ff0b9ed665295cbbaf19aafff5b0ced

if [ "$(cat "$RN_PKG/sdks/.hermesv1version")" != "$HERMES_TAG" ]; then
  echo "fetch.sh: react-native names Hermes $(cat "$RN_PKG/sdks/.hermesv1version"), pinned $HERMES_TAG" >&2
  exit 1
fi

CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"
SRC="$CACHE/src"
mkdir -p "$SRC"

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}
fresh() { [ -f "$SRC/$1.stamp" ] && [ "$(cat "$SRC/$1.stamp")" = "$2" ]; }
stamp() { echo "$2" > "$SRC/$1.stamp"; }

# A shallow fetch of one commit. Optional sparse paths keep a large repository small.
git_at() {
  local name="$1" url="$2" sha="$3"; shift 3
  fresh "$name" "$sha" && return 0
  echo "==> $name ${sha:0:12}"
  local tmp="$SRC/.$name.tmp"
  rm -rf "$tmp" "$SRC/$name"
  git init -q "$tmp"
  if [ $# -gt 0 ]; then
    git -C "$tmp" sparse-checkout set --no-cone "$@" > /dev/null
    git -C "$tmp" fetch -q --depth 1 --filter=blob:none "$url" "$sha"
  else
    git -C "$tmp" fetch -q --depth 1 "$url" "$sha"
  fi
  git -C "$tmp" -c advice.detachedHead=false checkout -q FETCH_HEAD
  [ "$(git -C "$tmp" rev-parse HEAD)" = "$sha" ] || { echo "fetch.sh: $name is not at $sha" >&2; exit 1; }
  rm -rf "$tmp/.git"
  mv "$tmp" "$SRC/$name"
  stamp "$name" "$sha"
}

# A download checked against its SHA-256 before it is used.
download() {
  local url="$1" sum="$2" out="$3"
  curl -fsSL --retry 3 -o "$out.tmp" "$url"
  if [ "$(sha256 "$out.tmp")" != "$sum" ]; then
    echo "fetch.sh: $url does not match its pinned SHA-256" >&2
    rm -f "$out.tmp"
    exit 1
  fi
  mv "$out.tmp" "$out"
}

t0=$(date +%s)
git_at react-native https://github.com/facebook/react-native "$RN_SHA" packages/react-native/ReactCxxPlatform
git_at hermes https://github.com/facebook/hermes "$HERMES_SHA"
git_at folly https://github.com/facebook/folly "$FOLLY_SHA"
git_at fast_float https://github.com/fastfloat/fast_float "$FAST_FLOAT_SHA"
git_at glog https://github.com/google/glog "$GLOG_SHA"
git_at fmt https://github.com/fmtlib/fmt "$FMT_SHA"
git_at double-conversion https://github.com/google/double-conversion "$DOUBLE_CONVERSION_SHA"

if ! fresh boost "$BOOST_SHA256"; then
  echo "==> boost headers"
  rm -rf "$SRC/boost" "$SRC/.boost.tmp"
  mkdir -p "$SRC/.boost.tmp"
  download "$BOOST_URL" "$BOOST_SHA256" "$SRC/.boost.tmp/boost.tar.bz2"
  # Headers only: folly's Uri parser uses Boost.Regex, which is header-only since 1.76.
  tar -xjf "$SRC/.boost.tmp/boost.tar.bz2" -C "$SRC/.boost.tmp" boost_1_83_0/boost
  mv "$SRC/.boost.tmp/boost_1_83_0" "$SRC/boost"
  rm -rf "$SRC/.boost.tmp"
  stamp boost "$BOOST_SHA256"
fi

if ! fresh nlohmann_json "$NLOHMANN_SHA256"; then
  echo "==> nlohmann_json"
  mkdir -p "$SRC/nlohmann_json/include/nlohmann"
  download "$NLOHMANN_URL" "$NLOHMANN_SHA256" "$SRC/nlohmann_json/include/nlohmann/json.hpp"
  stamp nlohmann_json "$NLOHMANN_SHA256"
fi

if ! fresh doctest "$DOCTEST_SHA256"; then
  echo "==> doctest"
  mkdir -p "$SRC/doctest/doctest"
  download "$DOCTEST_URL" "$DOCTEST_SHA256" "$SRC/doctest/doctest/doctest.h"
  stamp doctest "$DOCTEST_SHA256"
fi
t1=$(date +%s)

# React Native's own component codegen (FBReactNativeSpec), from the installed package.
if ! fresh codegen "$RN_VERSION"; then
  echo "==> codegen"
  tmp="$(mktemp -d)"
  (cd "$RN_PKG" && node scripts/generate-codegen-artifacts.js -p . -t android -o "$tmp" -s library -f) > "$tmp.log" 2>&1 || true
  JNI="$tmp/android/app/build/generated/source/codegen/jni"
  if [ ! -f "$JNI/react/renderer/components/FBReactNativeSpec/ComponentDescriptors.h" ]; then
    cat "$tmp.log" >&2
    echo "fetch.sh: React Native's codegen wrote no FBReactNativeSpec components" >&2
    exit 1
  fi
  rm -rf "$SRC/codegen"
  mkdir -p "$SRC/codegen"
  cp -R "$JNI/react" "$SRC/codegen/"
  rm -rf "$tmp" "$tmp.log"
  stamp codegen "$RN_VERSION"
fi
t2=$(date +%s)
echo "fetch: $((t1 - t0))s, codegen: $((t2 - t1))s, into $SRC"
