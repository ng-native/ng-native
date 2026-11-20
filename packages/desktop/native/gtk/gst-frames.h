// Decoded video frames handed from GStreamer to GTK: an `appsink` takes RGBA, each frame becomes a
// GdkMemoryTexture over the mapped buffer, with no copy, and the main loop shows the newest one
// only, to each picture watching: a frame the loop has not shown yet is replaced by the next.
// `gtk4paintablesink` is not used: el9 and Ubuntu 24.04 do not ship it.
#pragma once

#include <gst/gst.h>
#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>

namespace ngn::gtk {

class Frames {
 public:
  ~Frames();
  // From any thread: the newest frame (taken over), or none with `texture` null.
  static void post(const std::shared_ptr<Frames> &frames, GdkTexture *texture);
  // The frame shown now, borrowed. Main loop only, as are watch and unwatch.
  GdkTexture *shown() const { return shown_; }
  // `fn` hears each frame shown, or null as the frames are cleared, until unwatched.
  int watch(std::function<void(GdkTexture *)> fn);
  void unwatch(int id);

 private:
  void show(GdkTexture *texture);

  std::mutex mutex_;
  GdkTexture *pending_{nullptr};
  bool clear_{false};
  bool scheduled_{false};
  GdkTexture *shown_{nullptr};
  std::map<int, std::function<void(GdkTexture *)>> watchers_;
  int next_{0};
};

// An appsink, floating, whose frames go to `frames`, or null where appsink is not installed. `sync`
// renders each on the pipeline's clock, in square pixels, as a player's are.
GstElement *makeFrameSink(const std::shared_ptr<Frames> &frames, bool sync);

// A texture of `sample`'s RGBA frame over its buffer, with no copy; null for one that is not.
GdkTexture *textureOfSample(GstSample *sample);

} // namespace ngn::gtk
