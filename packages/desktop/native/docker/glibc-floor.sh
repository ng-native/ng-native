#!/usr/bin/env bash
# Fails unless every binary named needs glibc <floor> at most: the highest GLIBC_ symbol version
# each one imports, read with objdump. A binary that imports none, or that objdump cannot read,
# fails too.
#
#   glibc-floor.sh <floor, e.g. 2.34> <binary>...
set -euo pipefail
floor="${1:?usage: glibc-floor.sh <floor> <binary>...}"
shift
[ $# -gt 0 ] || { echo "glibc-floor.sh: no binaries named" >&2; exit 2; }
status=0
for binary in "$@"; do
  versions="$(objdump -T "$binary" | { grep -o 'GLIBC_[0-9][0-9.]*' || true; } | sed 's/^GLIBC_//' | sort -uV)"
  highest="$(tail -n 1 <<< "$versions")"
  if [ -z "$highest" ]; then
    echo "glibc-floor.sh: $binary imports no GLIBC_ symbol version" >&2
    status=1
  elif [ "$(printf '%s\n%s\n' "$highest" "$floor" | sort -V | tail -n 1)" != "$floor" ]; then
    echo "glibc-floor.sh: $binary needs glibc $highest, above $floor:" >&2
    objdump -T "$binary" | grep -F "GLIBC_$highest" >&2
    status=1
  else
    echo "$binary: glibc $highest at most"
  fi
done
exit "$status"
