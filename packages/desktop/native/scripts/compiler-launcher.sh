#!/usr/bin/env bash
# The CMake arguments that run every compile through a launcher such as ccache, one per line.
# An empty launcher clears each one, since CMake keeps a launcher an earlier build in the same
# directory set.
#
#   compiler-launcher.sh <launcher> [Darwin|Linux]
#
# build.sh and build-hermes.sh read the launcher from NGN_COMPILER_LAUNCHER. Objective-C and
# Objective-C++ are the AppKit host's, so only macOS names them.
set -euo pipefail
launcher="${1:-}"
os="${2:-$(uname -s)}"
langs=(C CXX)
[ "$os" = "Darwin" ] && langs+=(OBJC OBJCXX)
for lang in "${langs[@]}"; do
  echo "-DCMAKE_${lang}_COMPILER_LAUNCHER=$launcher"
done
