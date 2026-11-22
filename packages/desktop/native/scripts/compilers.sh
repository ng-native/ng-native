#!/usr/bin/env bash
# The CMake arguments that name the host's C and C++ compilers, one per line.
#
#   compilers.sh [Darwin|Linux]
#
# Off macOS the host is clang's, as Hermes and ICU are (build-hermes.sh, build-icu.sh): React
# Native's headers have `#pragma mark`, which GCC's -Wall rejects under -Werror, and CMake takes
# the system's cc and c++, which on most distributions is GCC. CC and CXX choose another compiler:
# each set is left to CMake, which reads it from the environment with any flags it carries
# (`clang -pthread`), where -DCMAKE_C_COMPILER would take the whole of it as the program's name.
# On macOS, Xcode's clang is CMake's own default, so nothing is named.
set -euo pipefail
os="${1:-$(uname -s)}"
[ "$os" = "Darwin" ] && exit 0
[ -z "${CC:-}" ] && echo "-DCMAKE_C_COMPILER=clang"
[ -z "${CXX:-}" ] && echo "-DCMAKE_CXX_COMPILER=clang++"
exit 0
