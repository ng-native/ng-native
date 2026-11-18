#!/usr/bin/env bash
# Builds the ICU fetch.sh pinned as static archives with their data linked in, for Hermes off
# macOS: its Unicode layer (case mapping, normalize, localeCompare, dates' toLocaleString) needs ICU
# even with Intl off, and a static copy ties the host to no distribution's ICU.
#
#   build-icu.sh <cache> <out-prefix>
#
# The data is built from its sources through icu-filter.json: English only, without the conversion
# tables, transliteration, break iterators and display-name trees Hermes never reads.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
CACHE="${1:?usage: build-icu.sh <cache> <out-prefix>}"
OUT="${2:?usage: build-icu.sh <cache> <out-prefix>}"
JOBS="${NGN_JOBS:-8}"
[ -x "$CACHE/src/icu/source/configure" ] || { echo "build-icu.sh: run fetch.sh first" >&2; exit 1; }

work="$OUT.build"
rm -rf "$work" "$OUT"
mkdir -p "$work"
cd "$work"
# Read when configure lays out the data build.
export ICU_DATA_FILTER_FILE="$here/icu-filter.json"
CC=clang CXX=clang++ CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC -std=c++17" \
  "$CACHE/src/icu/source/configure" --prefix="$OUT" --enable-static --disable-shared \
  --with-data-packaging=static --disable-tests --disable-samples --disable-extras \
  --disable-icuio --disable-layoutex > configure.log 2>&1 || { tail -40 configure.log >&2; exit 1; }
nice -n 10 make -j "$JOBS" > make.log 2>&1 || { tail -40 make.log >&2; exit 1; }
make install > install.log 2>&1 || { tail -40 install.log >&2; exit 1; }
for lib in icuuc icui18n icudata; do
  [ -f "$OUT/lib/lib$lib.a" ] || { echo "build-icu.sh: no lib$lib.a in $OUT/lib" >&2; exit 1; }
done
cd /
rm -rf "$work"
