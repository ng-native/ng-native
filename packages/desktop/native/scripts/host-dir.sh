#!/usr/bin/env bash
# Prints the directory build.sh builds the host in when the app links nothing of its own:
#
#   host-dir.sh <cache> <native source dir> [<library codegen dir>...]
#
# <cache>/host/build-<hash>, the hash taken over the native source folder (each install of the
# package has its own, and CMake refuses a build directory made from another) and the libraries'
# codegen folders, which codegen-library.sh names by each library's version and never changes.
# Apps that compile in different libraries, or other versions of them, build in directories of
# their own, so one never rebuilds the executable another is about to copy.
set -euo pipefail
cache="${1:?usage: host-dir.sh <cache> <native source dir> [<library dir>...]}"
source="${2:?usage: host-dir.sh <cache> <native source dir> [<library dir>...]}"
shift 2
key="$(printf '%s\n' "$source" "$@" | shasum | cut -c1-12)"
echo "$cache/host/build-$key"
