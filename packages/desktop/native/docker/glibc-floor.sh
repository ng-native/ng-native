#!/usr/bin/env bash
# Fails unless every binary named needs glibc <floor> at most: the highest GLIBC_ symbol version
# each one imports, read with objdump. A binary that imports none, or that objdump cannot read,
# fails too.
#
# A binary that imports OpenSSL (the host, through libcurl) must also need OpenSSL 3.0.0 at most,
# the oldest libssl.so.3 a tier 1 distribution ships (Ubuntu 24.04's 3.0.13): el9's headers are
# 3.5's, and a call newer than 3.0 there would stop the host loading on Ubuntu.
#
#   glibc-floor.sh <floor, e.g. 2.34> <binary>...
set -euo pipefail
floor="${1:?usage: glibc-floor.sh <floor> <binary>...}"
shift
[ $# -gt 0 ] || { echo "glibc-floor.sh: no binaries named" >&2; exit 2; }
openssl_floor=3.0.0
status=0

# The highest of a library's symbol versions a binary imports, by their prefix (GLIBC_, OPENSSL_).
highest() {
  objdump -T "$2" | { grep -o "$1[0-9][0-9.]*" || true; } | sed "s/^$1//" | sort -uV | tail -n 1
}
above() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" != "$2" ]
}

for binary in "$@"; do
  glibc="$(highest GLIBC_ "$binary")"
  if [ -z "$glibc" ]; then
    echo "glibc-floor.sh: $binary imports no GLIBC_ symbol version" >&2
    status=1
  elif above "$glibc" "$floor"; then
    echo "glibc-floor.sh: $binary needs glibc $glibc, above $floor:" >&2
    objdump -T "$binary" | grep -F "GLIBC_$glibc" >&2
    status=1
  else
    echo "$binary: glibc $glibc at most"
  fi
  openssl="$(highest OPENSSL_ "$binary")"
  if [ -n "$openssl" ]; then
    if above "$openssl" "$openssl_floor"; then
      echo "glibc-floor.sh: $binary needs OpenSSL $openssl, above $openssl_floor:" >&2
      objdump -T "$binary" | grep -F "OPENSSL_$openssl" >&2
      status=1
    else
      echo "$binary: OpenSSL $openssl at most"
    fi
  fi
done
exit "$status"
