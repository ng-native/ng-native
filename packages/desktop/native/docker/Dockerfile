# The Linux build image for the desktop host: AlmaLinux 9, so whatever it builds needs glibc 2.34 at
# most, with clang and lld from llvm-toolset. CI's host-linux job builds it on each run, and a Mac
# builds the same image with Docker (arm64, natively), from the repository's root:
#
#   docker build -t ngn-el9 packages/desktop/native/docker
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e NGN_DESKTOP_CACHE=/tmp/cache \
#     -v "$PWD:$PWD" -w "$PWD/packages/desktop" ngn-el9 \
#     native/scripts/build.sh --backend none --runtime --test
#
# Run it as a user other than root: root reads a file whatever its mode, so the core tests that make
# one unreadable fail.
FROM almalinux:9

# CRB has ninja, the GTK and libadwaita headers and nghttp2's; EPEL has ccache and Weston. python3
# builds ICU's filtered data and serves the libcurl client's tests. OpenSSL, nghttp2 and zlib are
# what the static libcurl links dynamically (cmake/curl.cmake). Xvfb, Weston, Mesa's software
# drivers, D-Bus and the fonts are for launching the GTK host headless, under X11 and Wayland, and
# pyatspi reads its accessibility tree over AT-SPI as a screen reader would (atspi-check.py).
RUN dnf -y install dnf-plugins-core epel-release \
 && dnf config-manager --set-enabled crb \
 && dnf -y module enable nodejs:24 \
 && dnf -y install \
      llvm-toolset clang lld cmake ninja-build ccache \
      git python3 perl perl-Digest-SHA nodejs \
      binutils diffutils file findutils procps-ng which \
      bzip2 tar unzip xz \
      libatomic sqlite-devel openssl-devel libnghttp2-devel zlib-devel \
      gtk4-devel libadwaita-devel pango-devel cairo-devel \
      xorg-x11-server-Xvfb weston mesa-dri-drivers dbus-daemon dbus-tools at-spi2-core python3-pyatspi \
      dejavu-sans-fonts google-noto-sans-fonts \
 && dnf clean all

ENV CC=clang CXX=clang++
