#!/usr/bin/env bash
# Prints what a Hermes build is for, which build-hermes.sh records beside it and hermes-built.sh
# compares, so a change to any of it builds Hermes again: on macOS the oldest macOS the host runs on
# (macos-target.sh); elsewhere the C library it links against and the ICU it links in (fetch.sh's
# pin, and how build-icu.sh builds it).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "macos $("$here/macos-target.sh")"
  exit 0
fi
sha256() {
  if command -v sha256sum > /dev/null; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1
}
glibc="$(getconf GNU_LIBC_VERSION | cut -d' ' -f2)"
icu="$(sed -n 's/^ICU\(_DATA\)\{0,1\}_SHA256=\([0-9a-f]*\)$/\2/p' "$here/fetch.sh" | tr '\n' ' ')"
[ -n "$glibc" ] && [ "$(wc -w <<< "$icu")" -eq 2 ] || { echo "hermes-target.sh: no glibc version or ICU pin" >&2; exit 1; }
echo "linux glibc $glibc icu ${icu% } build $(cat "$here/build-icu.sh" "$here/icu-filter.json" | sha256)"
