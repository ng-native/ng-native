#!/usr/bin/env bash
# Fetches React Native's own prebuilt Hermes for Apple platforms, the one its iOS apps run, and
# prints the folder with its universal macOS hermesvm.framework, hermesc and headers.
#
#   fetch-hermes.sh <node_modules/react-native> <debug|release>
#
# debug carries Hermes's debugger (CDP), as React Native's Debug builds do; release leaves it out.
# The tarball comes from Maven Central and is checked against the SHA-1 published beside it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RN_PKG="$(cd "${1:?usage: fetch-hermes.sh <node_modules/react-native> <debug|release>}" && pwd)"
FLAVOUR="${2:?usage: fetch-hermes.sh <node_modules/react-native> <debug|release>}"
case "$FLAVOUR" in debug | release) ;; *) echo "fetch-hermes.sh: debug or release, not $FLAVOUR" >&2; exit 2 ;; esac

RN_VERSION="$(node -p 'require(process.argv[1] + "/package.json").version' "$RN_PKG")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"
tag="$(cat "$RN_PKG/sdks/.hermesv1version")"
version="${tag#hermes-v}"
OUT="$CACHE/hermes-prebuilt-$version-$FLAVOUR"
framework="$OUT/destroot/Library/Frameworks/macosx/hermesvm.framework"

if [ ! -d "$framework" ] || [ ! -x "$OUT/destroot/bin/hermesc" ]; then
  base="${NGN_HERMES_MAVEN:-https://repo1.maven.org/maven2}/com/facebook/hermes/hermes-ios/$version"
  url="$base/hermes-ios-$version-hermes-ios-$FLAVOUR.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/hermes.tar.gz" "$url"
  expected="$(curl -fsSL --retry 3 "$url.sha1" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  actual="$(shasum -a 1 "$tmp/hermes.tar.gz" | cut -d' ' -f1)"
  if [ "${#expected}" != 40 ] || [ "$expected" != "$actual" ]; then
    echo "fetch-hermes.sh: $url has SHA-1 $actual, Maven publishes '$expected'" >&2
    exit 1
  fi
  mkdir -p "$tmp/x"
  tar -xzf "$tmp/hermes.tar.gz" -C "$tmp/x"
  [ -d "$tmp/x/destroot/Library/Frameworks/macosx/hermesvm.framework" ] ||
    { echo "fetch-hermes.sh: $url has no macOS hermesvm.framework" >&2; exit 1; }
  # Another build may fetch the same Hermes at once: publish under a lock, and keep a complete
  # copy it published rather than remove a folder it is reading.
  mkdir -p "$(dirname "$OUT")"
  # A held lock is waited on for at most ten minutes. One left by a build killed before its trap ran
  # is not taken over, since two builds taking it over at once could each remove the other's.
  lock="$OUT.lock"
  acquired=0
  absent=0
  for _ in $(seq 600); do
    if mkdir "$lock" 2>/dev/null; then
      acquired=1
      break
    fi
    # No lock, yet mkdir failed: its holder may have just released it, so retry, a few times.
    if [ ! -d "$lock" ]; then
      absent=$((absent + 1))
      [ "$absent" -lt 5 ] && continue
      echo "fetch-hermes.sh: cannot create $lock" >&2
      exit 1
    fi
    sleep 1
  done
  if [ "$acquired" != 1 ]; then
    echo "fetch-hermes.sh: $lock is still held after ten minutes; delete it if no build is running" >&2
    exit 1
  fi
  trap 'rm -rf "$tmp" "$lock"' EXIT
  if [ ! -d "$framework" ] || [ ! -x "$OUT/destroot/bin/hermesc" ]; then
    rm -rf "$OUT"
    mv "$tmp/x" "$OUT"
  fi
fi
echo "$OUT/destroot"
