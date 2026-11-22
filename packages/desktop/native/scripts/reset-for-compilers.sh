#!/usr/bin/env bash
# Clear a build directory's CMake cache when it was configured with another compiler than the one
# asked for now, as a build after the switch to clang (compilers.sh) finds one GCC configured.
#
#   reset-for-compilers.sh <build dir> [-DCMAKE_C_COMPILER=… -DCMAKE_CXX_COMPILER=…]
#
# CMake starts a directory over itself when its compiler changes, but without the -D's it was
# given, so RN_DIR and the rest come out empty and the configure fails. A directory configured with
# the compiler asked for keeps its cache, as does one where none is asked for (CC and CXX, which
# CMake reads once, being the caller's) or none is cached yet.
set -euo pipefail
build="$1"
shift
cache="$build/CMakeCache.txt"
[ -f "$cache" ] || exit 0
for arg in "$@"; do
  case "$arg" in
    -DCMAKE_C_COMPILER=* | -DCMAKE_CXX_COMPILER=*) ;;
    *) continue ;;
  esac
  name="${arg#-D}"
  name="${name%%=*}"
  wanted="${arg#*=}"
  cached="$(sed -n "s/^$name:[A-Z]*=//p" "$cache" | head -n 1)"
  [ -n "$cached" ] || continue
  # CMake keeps the path it found: compared by name, as the name is what is asked for.
  if [ "$(basename "$cached")" != "$(basename "$wanted")" ]; then
    rm -rf "$cache" "$build/CMakeFiles"
    exit 0
  fi
done
exit 0
