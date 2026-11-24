#!/usr/bin/env bash
# Builds the desktop host (or only the core and its tests) in the per-user cache, fetching the
# pinned sources and building Hermes first when they are missing. Prints the build directory.
#
#   build.sh [node_modules/react-native] [--backend appkit|gtk|none] [--runtime] [--universal]
#            [--debug|--release] [--test | --no-tests] [--no-debug-info]
#            [--library <node_modules/library>]... [--build-dir <dir>]
#
# Without a path, react-native is resolved from the current directory.
#
#   --backend none  the toolkit-free core and its tests only: any OS, no Hermes
#   --backend gtk   the GTK 4 host, ngn-linux: Linux's, and on a Mac a dev loop over Homebrew's GTK
#                   (brew install gtk4 libadwaita)
#   --runtime       with --backend none, the core's runtime half too: Hermes, ReactHost and the
#                   runtime tests, still with no toolkit (what Linux builds until it has a backend)
#   --universal     arm64 and x86_64 in one binary (default: this machine's architecture)
#   --debug         a Debug build (default: RelWithDebInfo)
#   --release       a Release build without the core tests, as a packaged app ships it
#   --test          run the core tests after building, and the AppKit or GTK view tests when it
#                   built them (the GTK ones need a display: xvfb-run on a Linux machine without one)
#   --no-tests      leave the core tests out, as an app's build does: the published package has
#                   none of their sources
#   --no-debug-info the default RelWithDebInfo build without its debug info, for a host that is
#                   stripped anyway (make-prebuilt.mjs): the same code, compiled and linked faster
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
# NGN_FIRST_BUILD_NOTE, how long a first build takes, is printed when the build directory has never
# been configured (scripts/first-build-note.sh).
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
no_tests=0
runtime=0
libraries=()
build_dir=""
debug_info=1
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) backend="$2"; shift ;;
    --runtime) runtime=1 ;;
    --universal) archs="arm64;x86_64" ;;
    --debug) config=Debug ;;
    --release) config=Release; tests=OFF ;;
    --test) run_tests=1 ;;
    --no-tests) tests=OFF; no_tests=1 ;;
    --no-debug-info) debug_info=0 ;;
    --library) libraries+=("$2"); shift ;;
    --build-dir) build_dir="$2"; shift ;;
    *) echo "build.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
if [ "$run_tests" = 1 ] && [ "$tests" = OFF ]; then
  if [ "$no_tests" = 1 ]; then left_out=--no-tests; else left_out=--release; fi
  echo "build.sh: --test needs the core tests, which $left_out leaves out" >&2
  exit 2
fi
# A backend always has the runtime half.
[ "$backend" = "none" ] || runtime=1
# CMAKE_OSX_ARCHITECTURES means nothing off macOS.
[ "$(uname -s)" = "Darwin" ] || archs=""

JOBS="${NGN_JOBS:-8}"
RN_VERSION="$(node -p 'require(process.argv[1] + "/package.json").version' "$RN_PKG")"
CACHE="$("$here/cache-dir.sh" "$RN_VERSION")"

fetch_args=()
[ "$backend" = "gtk" ] && fetch_args=(--curl)
"$here/fetch.sh" "$RN_PKG" ${fetch_args[@]+"${fetch_args[@]}"} >&2

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
"$here/prune-hosts.sh" "$(dirname "$CACHE")"
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

# Off macOS archs is blank, and Hermes is built for this machine's architecture, under the same
# name as on macOS.
arch_key="${archs//;/-}"
[ -n "$arch_key" ] || arch_key="$(uname -m)"
variant="$backend"
[ "$backend" = "none" ] && [ "$runtime" = 1 ] && variant=none-runtime
BUILD="${build_dir:-$host_dir/$variant-$arch_key-$config}"
# How long a first build takes, when this directory has none yet (NGN_FIRST_BUILD_NOTE), before
# Hermes or the host compiles.
"$here/first-build-note.sh" "$BUILD"

launcher_args=()
while IFS= read -r arg; do
  launcher_args+=("$arg")
done < <("$here/compiler-launcher.sh" "${NGN_COMPILER_LAUNCHER:-}")

compiler_args=()
while IFS= read -r arg; do
  compiler_args+=("$arg")
done < <("$here/compilers.sh")

# RelWithDebInfo's flags, with or without -g, set either way: CMake keeps a -D in the build
# directory's cache, so a build with debug info after one without would otherwise go without too.
# Hermes builds as Release, which has none.
flags_args=()
if [ "$config" = RelWithDebInfo ]; then
  flags="-O2 -g -DNDEBUG"
  [ "$debug_info" = 0 ] && flags="-O2 -DNDEBUG"
  langs=(C CXX)
  [ "$(uname -s)" = "Darwin" ] && langs+=(OBJC OBJCXX)
  for lang in "${langs[@]}"; do
    flags_args+=("-DCMAKE_${lang}_FLAGS_RELWITHDEBINFO=$flags")
  done
fi

hermes_args=()
if [ "$backend" = "appkit" ]; then
  # React Native's own prebuilt Hermes, universal: with the debugger for a dev build, as React
  # Native's Debug builds have it, and without for Release.
  hermes_flavour=debug
  [ "$config" = Release ] && hermes_flavour=release
  hermes_args=(-DNGN_HERMES_PREBUILT="$("$here/fetch-hermes.sh" "$RN_PKG" "$hermes_flavour")")
elif [ "$runtime" = 1 ]; then
  hermes="$CACHE/hermes-$arch_key"
  # Built again when missing, or built for another macOS than the host's.
  if ! "$here/hermes-built.sh" "$hermes"; then
    # One Hermes build at a time for this cache and architecture: build-hermes.sh (and, off macOS,
    # build-icu.sh) clears and refills one output directory, which a second build would delete from
    # under the first. Locked as fetch.sh locks (the kernel's flock through this shell's descriptor
    # 8, taken by Perl since macOS has no flock command), and checked again once held, so a build
    # that waited uses the Hermes the first one finished.
    exec 8>> "$CACHE/.hermes-$arch_key-lock"
    perl -MFcntl=:flock -e 'open(my $fd, ">&=", 8) or die "build.sh: $!\n"; flock($fd, LOCK_EX) or die "build.sh: $!\n"'
    if ! "$here/hermes-built.sh" "$hermes"; then
      "$here/build-hermes.sh" "$RN_PKG" "$archs" >&2
    fi
    exec 8>&-
  fi
  hermes_args=(-DNGN_HERMES_BUILD="$hermes")
fi

# One build at a time in it (build-lock.sh), held until this script and the ninja it runs end.
. "$here/build-lock.sh"
lock_build "$BUILD"
# Configured with GCC before the build named clang, it starts over (reset-for-compilers.sh).
"$here/reset-for-compilers.sh" "$BUILD" ${compiler_args[@]+"${compiler_args[@]}"}
cmake --log-level=WARNING -G Ninja -S "$native_dir" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE="$config" \
  -DCMAKE_OSX_ARCHITECTURES="$archs" \
  -DNGN_BACKEND="$backend" \
  -DNGN_RUNTIME="$([ "$runtime" = 1 ] && echo ON || echo OFF)" \
  -DRN_DIR="$RN_PKG" \
  -DNGN_SOURCES="$CACHE/src" \
  -DNGN_LIBRARIES="$library_dirs" \
  -DNGN_TESTS="$tests" \
  "${link_args[@]}" \
  ${compiler_args[@]+"${compiler_args[@]}"} \
  ${launcher_args[@]+"${launcher_args[@]}"} \
  ${flags_args[@]+"${flags_args[@]}"} \
  ${hermes_args[@]+"${hermes_args[@]}"} >&2
# Ninja itself, as CMake chose it, rather than through `cmake --build`: CMake starts its build tool
# with none of this shell's descriptors, so a ninja left running after a killed `cmake --build`
# would build on without the lock. Started from here it holds descriptor 7 until it ends.
ninja=$(sed -n 's/^CMAKE_MAKE_PROGRAM:[A-Z]*=//p' "$BUILD/CMakeCache.txt")
nice -n 10 "${ninja:-ninja}" -C "$BUILD" -j "$JOBS" >&2
if [ "$run_tests" = 1 ]; then
  "$BUILD/ngn_core_tests" >&2
  # Hermes and the runtime half, which a build with the runtime has.
  if [ -x "$BUILD/ngn_runtime_tests" ]; then
    "$BUILD/ngn_runtime_tests" >&2
  fi
  # The AppKit view tests, which a build with the AppKit backend has.
  if [ -x "$BUILD/appkit/ngn_appkit_tests" ]; then
    "$BUILD/appkit/ngn_appkit_tests" >&2
  fi
  # The GTK view tests, which a build with the GTK backend has.
  if [ -x "$BUILD/gtk/ngn_gtk_tests" ]; then
    "$BUILD/gtk/ngn_gtk_tests" >&2
  fi
fi
echo "$BUILD"
