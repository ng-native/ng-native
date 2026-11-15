#!/usr/bin/env bash
# The CMake arguments that run every compile through a launcher such as ccache, one per line.
# Prints nothing for an empty launcher, so a build that sets none is unchanged.
#
#   compiler-launcher.sh <launcher> [Darwin|Linux]
#
# build.sh and build-hermes.sh read the launcher from NGN_COMPILER_LAUNCHER. Objective-C and
# Objective-C++ are the AppKit host's, so only macOS names them.
set -euo pipefail
launcher="${1:-}"
os="${2:-$(uname -s)}"
[ -n "$launcher" ] || exit 0
langs=(C CXX)
[ "$os" = "Darwin" ] && langs+=(OBJC OBJCXX)
for lang in "${langs[@]}"; do
  echo "-DCMAKE_${lang}_COMPILER_LAUNCHER=$launcher"
done
