#!/usr/bin/env bash
# Checks a `.deb`'s Depends against what the GTK host links: in a clean Debian or Ubuntu container,
# installs only the packages named, then fails when the dynamic loader cannot find a library the
# host needs, directly or through another library. dpkg never reads the binary, so a library
# missing from bin/package-linux.mjs's DEB_DEPENDS fails here rather than on a user's machine.
#
#   deb-depends-check.sh <ngn-linux> <package>...
#
# CI runs it in ubuntu:24.04 with the package names DEB_DEPENDS gives.
set -euo pipefail
host="${1:?usage: deb-depends-check.sh <ngn-linux> <package>...}"
shift
[ $# -gt 0 ] || { echo "deb-depends-check: no packages named" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends "$@" > /dev/null
libraries=$(ldd "$host")
if grep 'not found' <<< "$libraries" >&2; then
  echo "deb-depends-check: with only $* installed, the host cannot find the libraries above" >&2
  exit 1
fi
echo "deb-depends-check: all $(wc -l <<< "$libraries") libraries the host loads are found with $*"
