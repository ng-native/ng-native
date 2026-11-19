// The OS half of NgNativeAudio on Linux (the core's audio.h), over GStreamer.
//
// Playback is a `playbin3` per track (gst-playback.h), with no video, its pitch kept at any rate,
// into PulseAudio's sink, which PipeWire answers as well. Recording is the default source
// (`pulsesrc`, a PipeWire source through pipewire-pulse too) into an encoder and a muxer by the
// recording's extension: AAC in MPEG-4 (.m4a, .mp4), linear PCM in WAV (.wav), and Opus in Ogg
// (.ogg, .opus). Another extension, or a format with no encoder installed, fails to prepare with
// why. Metering is the `level` element's RMS of the first channel.
//
// There is no microphone permission on Linux: whoever reaches the PipeWire or PulseAudio socket may
// record, so access is always granted and nothing is asked. Whether there is a microphone is
// whether GstDeviceMonitor lists an audio source that is not a monitor of an output.
#pragma once

#include "ngn/audio.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// Null when GStreamer or playbin3 is not installed. `sink` is the audio sink's factory name, empty
// for GStreamer's own choice.
std::shared_ptr<AudioOutput> makeAudioOutput(std::string sink = "");

struct AudioInputSetup {
  // The source, as a gst-launch description; empty for `pulsesrc`.
  std::string source;
  // Whether there is a microphone; empty to ask GstDeviceMonitor.
  std::function<bool()> microphone;
};

// Null when GStreamer has no source to record from.
std::shared_ptr<AudioInput> makeAudioInput(AudioInputSetup setup = {});

// The encoder and muxer (gst-launch descriptions) a recording is made with, or why there are none.
struct RecordingElements {
  std::string encoder;
  std::string muxer;
  std::string error;
};
RecordingElements recordingElementsOf(const RecordingSettings &settings);

} // namespace ngn::gtk
