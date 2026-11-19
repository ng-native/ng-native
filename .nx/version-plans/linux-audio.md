---
__default__: patch
---

On the GTK desktop host on Linux, `audioPlayer()` and `audioRecorder()` work through GStreamer 1.22 or later, where its base and good plugins are installed.

A player plays a file or an HTTP or HTTPS source through PulseAudio's sink, which PipeWire also answers, keeping its pitch at any rate. A source with a stream no installed GStreamer plugin decodes fails with a message naming it; a stock RHEL 9 install has no H.264 decoder. A recorder records from the default source, through PulseAudio or PipeWire, as AAC in `.m4a` or `.mp4` (with an AAC encoder installed, such as bad-free's on RHEL 9), linear PCM in `.wav`, or Opus in `.ogg`; another extension is refused when the recording is prepared. Linux has no microphone permission, so the permission is always granted and nothing is asked. A host built without GStreamer, such as the dev loop on a Mac, leaves the module absent.
