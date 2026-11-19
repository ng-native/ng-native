#!/usr/bin/env bash
# Installs what a built GTK host needs on this distribution, from its own packages, and launches the
# host on a bundle to its first frame on each display asked for, with launch-probe.sh. Run as root,
# in a container of the distribution or on a runner of it. The nightly desktop workflow runs it on
# each distribution the Linux host supports, with a host built in the AlmaLinux 9 image.
#
#   launch-cell.sh <host> <bundle.js> <out dir> <cell>...
#
# Cells:
#   x11      Xvfb, the renderer GTK picks (GL over Mesa's software rasteriser)
#   wayland  headless Weston, pixman
#   vulkan   Xvfb with GSK_RENDERER=vulkan over lavapipe, Mesa's software Vulkan
#   mutter   mutter --headless on Wayland, GNOME's compositor
#
# Fails on a library the host needs and the distribution's packages do not give it, and on any
# probe that fails. Each probe saves the window it drew, in-process, as <out>/<cell>.png.
set -euo pipefail
host="${1:?usage: launch-cell.sh <host> <bundle.js> <out dir> <cell>...}"
bundle="${2:?usage: launch-cell.sh <host> <bundle.js> <out dir> <cell>...}"
out="${3:?usage: launch-cell.sh <host> <bundle.js> <out dir> <cell>...}"
shift 3
[ "$#" -gt 0 ] || { echo "launch-cell: name at least one cell" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"

has_cell() {
  local cell
  for cell in "${cells[@]}"; do [ "$cell" = "$1" ] && return 0; done
  return 1
}
cells=("$@")
for cell in "${cells[@]}"; do
  case "$cell" in x11 | wayland | vulkan | mutter) ;; *)
    echo "launch-cell: no cell named $cell" >&2
    exit 2
    ;;
  esac
done
mkdir -p "$out"

# What the host links (DEB_DEPENDS in bin/package-linux.mjs, and the rpm's equivalents), and what
# the cells run.
. /etc/os-release
case "$ID" in
  ubuntu | debian)
    export DEBIAN_FRONTEND=noninteractive
    packages=(libc6 libgtk-4-1 libadwaita-1-0 libsecret-1-0 glib-networking libgstreamer1.0-0 libgstreamer-plugins-base1.0-0
      libssl3t64 libnghttp2-14 zlib1g libsqlite3-0 libatomic1 libstdc++6
      xvfb weston libgl1-mesa-dri libegl-mesa0 dbus fonts-dejavu-core)
    has_cell vulkan && packages+=(mesa-vulkan-drivers)
    has_cell mutter && packages+=(mutter)
    apt-get update -q
    apt-get install -y -q --no-install-recommends "${packages[@]}"
    ;;
  fedora | almalinux | rhel)
    # OpenSSL by the soname the host links, as an rpm's own requirements name it: Fedora 45 moved
    # openssl-libs to OpenSSL 4, and keeps libssl.so.3 in openssl3-libs.
    packages=(gtk4 libadwaita libsecret glib-networking gstreamer1 gstreamer1-plugins-base
      'libssl.so.3()(64bit)' 'libcrypto.so.3()(64bit)' libnghttp2 sqlite-libs libatomic libstdc++ xorg-x11-server-Xvfb weston mesa-dri-drivers dbus-daemon
      dejavu-sans-fonts)
    has_cell vulkan && packages+=(mesa-vulkan-drivers)
    has_cell mutter && packages+=(mutter)
    dnf -y -q install "${packages[@]}"
    ;;
  *)
    echo "launch-cell: no package list for $ID" >&2
    exit 2
    ;;
esac
echo "launch-cell: $PRETTY_NAME, $(uname -m)"

missing="$(ldd "$host" | grep 'not found' || true)"
if [ -n "$missing" ]; then
  echo "launch-cell: the host needs libraries this distribution's packages did not install:" >&2
  echo "$missing" >&2
  exit 1
fi

XDG_RUNTIME_DIR="$(mktemp -d)"
export GTK_A11Y=none XDG_RUNTIME_DIR
chmod 700 "$XDG_RUNTIME_DIR"
pids=()
cleanup() {
  local pid
  for pid in "${pids[@]}"; do kill "$pid" 2> /dev/null || true; done
}
trap cleanup EXIT

wait_for() {
  local what="$1" path="$2" log="$3"
  for _ in $(seq 100); do
    [ -e "$path" ] && return 0
    sleep 0.2
  done
  echo "launch-cell: $what did not start" >&2
  cat "$log" >&2
  exit 1
}

xvfb() {
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp > "$out/xvfb.log" 2>&1 &
  pids+=($!)
  wait_for Xvfb /tmp/.X11-unix/X99 "$out/xvfb.log"
}

failed=()
probe() {
  local cell="$1"
  shift
  echo "::group::$cell"
  if env "$@" NGN_CAPTURE="$out/$cell.png" "$here/launch-probe.sh" "$host" "$bundle"; then
    echo "launch-cell: $cell passed"
  else
    failed+=("$cell")
  fi
  echo "::endgroup::"
}

if has_cell x11 || has_cell vulkan; then xvfb; fi
has_cell x11 && probe x11 DISPLAY=:99 GDK_BACKEND=x11
has_cell vulkan && probe vulkan DISPLAY=:99 GDK_BACKEND=x11 GSK_RENDERER=vulkan

if has_cell wayland; then
  # Weston 10 and later name the backend and the renderer; Weston 8 takes the module.
  if weston --help 2>&1 | grep -q -- --renderer; then
    headless=(--backend=headless --renderer=pixman)
  else
    headless=(--backend=headless-backend.so --use-pixman)
  fi
  weston "${headless[@]}" --socket=ngn-weston --width=1280 --height=800 > "$out/weston.log" 2>&1 &
  pids+=($!)
  wait_for Weston "$XDG_RUNTIME_DIR/ngn-weston" "$out/weston.log"
  probe wayland WAYLAND_DISPLAY=ngn-weston GDK_BACKEND=wayland
fi

if has_cell mutter; then
  # mutter wants a session bus, and a system bus, where a private one stands in (no logind on it).
  dbus-daemon --config-file=/usr/share/dbus-1/session.conf --address="unix:path=$XDG_RUNTIME_DIR/system_bus" \
    --fork --nopidfile
  export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/system_bus"
  dbus-daemon --session --address="unix:path=$XDG_RUNTIME_DIR/session_bus" --fork --nopidfile
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/session_bus"
  mutter --headless --wayland --no-x11 --virtual-monitor 1280x800 > "$out/mutter.log" 2>&1 &
  pids+=($!)
  wait_for mutter "$XDG_RUNTIME_DIR/wayland-0" "$out/mutter.log"
  probe mutter WAYLAND_DISPLAY=wayland-0 GDK_BACKEND=wayland
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "launch-cell: failed on $PRETTY_NAME: ${failed[*]}" >&2
  exit 1
fi
echo "launch-cell: every cell passed on $PRETTY_NAME: ${cells[*]}"
