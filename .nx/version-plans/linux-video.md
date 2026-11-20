---
__default__: patch
---

On the GTK desktop host on Linux, `videoPlayer()` and `<expo-video>` work through GStreamer 1.22 or later, where its base and good plugins are installed.

A player plays a file or an HTTP or HTTPS source, HLS included where GStreamer's bad plugins are installed, into each view that names it. A source with a stream no installed GStreamer plugin decodes fails with a message naming the missing decoder: a stock RHEL 9 install has no H.264 decoder, which Cisco's openh264 plugin adds. With `nativeControls` the view shows its own play and pause button and position slider, and a full-screen button unless `fullscreenOptions.enable` is false, since GTK has no player view. Full screen opens a window of its own, asked to fill the screen, which Escape or closing it leaves; a window manager that will not make it full screen leaves it a window. Picture in picture is absent.
