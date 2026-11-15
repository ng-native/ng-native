#!/usr/bin/env bash
# Builds the desktop host (or only the core and its tests) in the per-user cache, fetching the
# pinned sources and building Hermes first when they are missing. Prints the build directory.
#
#   build.sh [node_modules/react-native] [--backend appkit|none] [--universal] [--debug|--release]
#            [--test] [--library <node_modules/library>]... [--build-dir <dir>]
#
# Without a path, react-native is resolved from the current directory.
#
#   --backend none  the toolkit-free core and its tests only: any OS, no Hermes
#   --universal     arm64 and x86_64 in one binary (default: this machine's architecture)
#   --debug         a Debug build (default: RelWithDebInfo)
#   --release       a Release build without the core tests, as a packaged app ships it
#   --test          run the core tests after building
#   --library       a library whose Fabric components the host compiles in (its codegen, by
#                   scripts/codegen-library.sh); repeatable. A build without one drops them all.
#   --build-dir     build here instead of the cache's shared build directory, for a build that
#                   no other may touch before its output is copied (make-prebuilt.mjs)
#
# An app that links nothing builds in a directory keyed by this install's native sources and the
# libraries it compiles in (scripts/host-dir.sh), shared only with apps that build the same.
#
# NGN_DESKTOP_LINK names the app's link.json (bin/autolink.mjs): the libraries and app modules
# compiled in (cmake/linked-modules.cmake). An app that links any builds in a directory of its own,
# so its native code never rebuilds another app's host, and adding or removing one recompiles that
# one and relinks.
#
# NGN_JOBS caps parallel compiles (default 8).
#
# NGN_COMPILER_LAUNCHER, e.g. ccache, runs every compile of the host and of Hermes through it.
# Unset, the build is as it was.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then
  RN_PKG="$(cd "$1" && pwd)"
  shift
else
  RN_PKG="$(node -p "require('path').dirname(require.resolve('react-native/package.json', { paths: [process.cwd()] }))")"
fi
backend=none
[ "$(uname -s)" = "Darwin" ] && backend=appkit
archs="$(uname -m)"
config=RelWithDebInfo
run_tests=0
tests=ON
libraries=()
build_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) backend="$2"; shift ;;
    --universal) archs="arm64;x86_64" ;;
    --debug) config=Debug ;;
    --release) config=Release; tests=OFF ;;
    --test) run_tests=1 ;;
    --library) libraries+=("$2"); shift ;;
    --build-dir) build_dir="$2"; shift ;;
    *) echo "build.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
if [ "$run_tests" = 1 ] && [ "$tests" = OFF ]; then
  echo "build.sh: --test needs the core tests, which --release leaves out" >&2
  exit 2
fi
# CMAKE_OSX_ARCHITECTURES means nothing off macOS.
[ "$(uname -s)" = "Darwin" ] || archs=""

JOBS="${NGN_JOBS:-8}"
RN_VERSION="$(node -p 'require(process.argv[1] + "/package.json").version' "$RN_PKG")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"

"$here/fetch.sh" "$RN_PKG" >&2

library_dirs=""
for lib in ${libraries[@]+"${libraries[@]}"}; do
  library_dirs="$library_dirs${library_dirs:+;}$("$here/codegen-library.sh" "$RN_PKG" "$lib")"
done

link_args=()
# Keyed by this install's native sources and the libraries compiled in, so another install or an
# app with other libraries never rebuilds this one's executable.
native_dir="$(cd "$here/.." && pwd -P)"
library_list=()
[ -n "$library_dirs" ] && IFS=';' read -ra library_list <<< "$library_dirs"
host_dir="$("$here/host-dir.sh" "$CACHE" "$native_dir" ${library_list[@]+"${library_list[@]}"})"
if [ -n "${NGN_DESKTOP_LINK:-}" ] && [ "$backend" != "none" ]; then
  link="$(cd "$(dirname "$NGN_DESKTOP_LINK")" && pwd -P)/$(basename "$NGN_DESKTOP_LINK")"
  # The libraries' package names and directories, one per line, when the app links anything.
  linked="$(node -e '
    const link = require(process.argv[1]);
    if (link.version !== 1) { console.error(`build.sh: ${process.argv[1]} is version ${link.version}, not 1`); process.exit(1); }
    if (link.libraries.length + link.appModules.length === 0) process.exit(0);
    console.log("linked");
    for (const lib of link.libraries) console.log(`${lib.name}\t${lib.dir}`);
  ' "$link")"
  if [ -n "$linked" ]; then
    codegen=""
    while IFS=$'\t' read -r name dir; do
      out="$("$here/codegen-library.sh" "$RN_PKG" "$dir" --modules)"
      [ -n "$out" ] && codegen="$codegen${codegen:+;}$name|$out"
      # Its Fabric components, when it has any: compiled in and registered like a --library's.
      [ -n "$out" ] && [ -f "$out/library.cmake" ] && library_dirs="$library_dirs${library_dirs:+;}$out"
    done < <(tail -n +2 <<< "$linked")
    # The app is link.json's .expo/ng-native-desktop/..
    app="$(cd "$(dirname "$link")/../.." && pwd -P)"
    host_dir="$CACHE/host/app-$(printf '%s' "$app" | shasum | cut -c1-12)"
    mkdir -p "$host_dir"
    echo "$app" > "$host_dir/app"
    link_args=(-DNGN_DESKTOP_LINK="$link" -DNGN_LINK_CODEGEN="$codegen")
  fi
fi
[ ${#link_args[@]} -eq 0 ] && link_args=(-DNGN_DESKTOP_LINK= -DNGN_LINK_CODEGEN=)

launcher_args=()
while IFS= read -r arg; do
  launcher_args+=("$arg")
done < <("$here/compiler-launcher.sh" "${NGN_COMPILER_LAUNCHER:-}")

arch_key="${archs//;/-}"
hermes_args=()
if [ "$backend" != "none" ]; then
  hermes="$CACHE/hermes-$arch_key"
  # Built again when missing, or built for another macOS than the host's.
  if ! "$here/hermes-built.sh" "$hermes"; then
    "$here/build-hermes.sh" "$RN_PKG" "$archs" >&2
  fi
  hermes_args=(-DNGN_HERMES_BUILD="$hermes")
fi

BUILD="${build_dir:-$host_dir/$backend-${arch_key:-native}-$config}"
cmake --log-level=WARNING -G Ninja -S "$native_dir" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE="$config" \
  -DCMAKE_OSX_ARCHITECTURES="$archs" \
  -DNGN_BACKEND="$backend" \
  -DRN_DIR="$RN_PKG" \
  -DNGN_SOURCES="$CACHE/src" \
  -DNGN_LIBRARIES="$library_dirs" \
  -DNGN_TESTS="$tests" \
  "${link_args[@]}" \
  ${launcher_args[@]+"${launcher_args[@]}"} \
  ${hermes_args[@]+"${hermes_args[@]}"} >&2
nice -n 10 cmake --build "$BUILD" -j "$JOBS" >&2
if [ "$run_tests" = 1 ]; then
  "$BUILD/ngn_core_tests" >&2
fi
echo "$BUILD"
