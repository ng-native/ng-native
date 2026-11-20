// One GStreamer `playbin3` playing one source, as the audio and video players on Linux need it:
// its load state, position and duration, play and pause at a rate, seeks that answer once the
// position is there, volume and mute, and a change sent as it loads, fails, starts, stalls, stops
// or ends, and every interval while it plays.
//
// A source with a stream no decoder is installed for fails with the decoder's name: playbin3 posts
// no error for it, only a missing-plugin message, and would sit at the start. H.264 has no decoder
// on a stock RHEL 9.
//
// Bus messages and the interval are handled on the default main context, the GTK main loop's:
// `changed` runs there, never on a streaming thread. Every other call is from any thread. The
// destructor stops the pipeline and sends nothing after; a change already running on the main loop
// may still finish, which the caller guards (audio.h and video.h say how).
#pragma once

#include <gst/gst.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn::gtk {

// Initialises GStreamer once for the process; false when it cannot be, or when `elements` (factory
// names) are not all installed. Any thread.
bool gstreamerHas(std::initializer_list<const char *> elements);

struct PlaybackState {
  enum class Load { Loading, Ready, Failed };
  Load load{Load::Loading};
  std::string error;
  bool playing{false};
  bool buffering{false};
  bool ended{false};
  // Seconds; a duration not known yet is 0.
  double currentTime{0};
  double duration{0};
  double bufferedPosition{0};
};

class Playback {
 public:
  enum class Change { State, Time, Ended };
  struct Options {
    // The audio sink's factory name; empty for playbin3's own choice (autoaudiosink, which takes
    // PulseAudio's, PipeWire's included, first).
    std::string audioSink;
    // The video sink, taken over; null plays no video.
    GstElement *videoSink{nullptr};
    // Keeps the pitch at any rate (scaletempo).
    bool preservePitch{true};
    // Seconds between Time changes while playing; 0 sends none.
    double interval{0};
  };

  Playback(const std::string &uri, Options options, std::function<void(Change)> changed);
  ~Playback();
  Playback(const Playback &) = delete;
  Playback &operator=(const Playback &) = delete;

  PlaybackState state();
  // A rate of 0 or less pauses.
  void play(double rate);
  void pause();
  // `done` once the position is there (on the main loop), or as the playback goes.
  void seek(double seconds, std::function<void()> done);
  void setRate(double rate);
  void setVolume(double volume);
  void setMuted(bool muted);
  void setInterval(double seconds);

  struct Shared;

 private:
  std::shared_ptr<Shared> shared_;
};

} // namespace ngn::gtk
