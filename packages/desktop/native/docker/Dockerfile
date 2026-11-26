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
# builds ICU's filtered data and serves the libcurl client's tests. npm installs another React
# Native version for a prebuilt host (make-prebuilt.mjs --react-native). OpenSSL, nghttp2 and zlib are
# what the static libcurl links dynamically (cmake/curl.cmake). Xvfb, Weston, Mesa's software
# drivers, D-Bus and the fonts are for launching the GTK host headless, under X11 and Wayland, and
# pyatspi reads its accessibility tree over AT-SPI as a screen reader would (atspi-check.py).
# libsecret is SecureStore's. GStreamer's headers and its base, good and bad-free plugins are the
# audio and video players' and recorders' (gst-playback.h), and their tests' encoders. The English
# locales are for the GTK tests of a 12-hour clock (en_US) beside a 24-hour one, and the German for
# a locale that writes neither AM nor PM (de_DE); both are for the Localization tests too.
RUN dnf -y install dnf-plugins-core epel-release \
 && dnf config-manager --set-enabled crb \
 && dnf -y module enable nodejs:24 \
 && dnf -y install \
      llvm-toolset clang lld cmake ninja-build ccache \
      git python3 perl perl-Digest-SHA nodejs npm \
      binutils diffutils file findutils procps-ng which \
      bzip2 tar unzip xz \
      libatomic sqlite-devel openssl-devel libnghttp2-devel zlib-devel \
      gtk4-devel libadwaita-devel pango-devel cairo-devel libsecret-devel \
      gstreamer1-devel gstreamer1-plugins-base-devel gstreamer1-plugins-good gstreamer1-plugins-bad-free \
      xorg-x11-server-Xvfb weston mesa-dri-drivers dbus-daemon dbus-tools at-spi2-core python3-pyatspi \
      dejavu-sans-fonts google-noto-sans-fonts glibc-langpack-en glibc-langpack-de \
 && dnf clean all

ENV CC=clang CXX=clang++
