#!/usr/bin/env bash
# Prints the directory build.sh builds the host in for a set of compiled-in libraries, when the app
# links nothing of its own:
#
#   host-dir.sh <cache> [<library codegen dir>...]
#
# <cache>/host with no libraries, otherwise <cache>/host/libs-<hash>, the hash taken over each
# library's directory and its stamp (its name, version and source folder, from
# codegen-library.sh). Apps that compile in different libraries, or other versions of them, build in
# directories of their own, so one never rebuilds the executable another is about to copy.
set -euo pipefail
cache="${1:?usage: host-dir.sh <cache> [<library dir>...]}"
shift
if [ $# -eq 0 ]; then
  echo "$cache/host"
  exit 0
fi
key="$(for dir in "$@"; do
  printf '%s\n' "$dir"
  cat "$dir/stamp" 2>/dev/null || true
done | shasum | cut -c1-12)"
echo "$cache/host/libs-$key"
