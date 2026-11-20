#include "gst-frames.h"

#include <gst/app/gstappsink.h>
#include <gst/video/video.h>

#include <utility>
#include <vector>

namespace ngn::gtk {

Frames::~Frames() {
  if (pending_) {
    g_object_unref(pending_);
  }
  if (shown_) {
    g_object_unref(shown_);
  }
}

void Frames::post(const std::shared_ptr<Frames> &frames, GdkTexture *texture) {
  std::lock_guard lock(frames->mutex_);
  if (frames->pending_) {
    g_object_unref(frames->pending_);
  }
  frames->pending_ = texture;
  // A clear stays for the watchers to hear first, even when a frame of the next source follows it.
  frames->clear_ = frames->clear_ || texture == nullptr;
  if (frames->scheduled_) {
    return;
  }
  frames->scheduled_ = true;
  g_idle_add_full(G_PRIORITY_HIGH_IDLE, [](gpointer data) -> gboolean {
    auto &frames = *static_cast<std::shared_ptr<Frames> *>(data);
    GdkTexture *texture;
    bool clear;
    {
      std::lock_guard lock(frames->mutex_);
      texture = std::exchange(frames->pending_, nullptr);
      clear = std::exchange(frames->clear_, false);
      frames->scheduled_ = false;
    }
    if (clear) {
      frames->show(nullptr);
    }
    if (texture) {
      frames->show(texture);
    }
    return G_SOURCE_REMOVE;
  }, new std::shared_ptr<Frames>(frames), [](gpointer data) { delete static_cast<std::shared_ptr<Frames> *>(data); });
}

void Frames::show(GdkTexture *texture) {
  if (shown_) {
    g_object_unref(shown_);
  }
  shown_ = texture;
  // A watcher may stop watching, itself or another, as it is called: each is looked up again.
  std::vector<int> ids;
  for (auto &[id, fn] : watchers_) {
    ids.push_back(id);
  }
  for (int id : ids) {
    auto found = watchers_.find(id);
    if (found != watchers_.end()) {
      auto fn = found->second;
      fn(texture);
    }
  }
}

int Frames::watch(std::function<void(GdkTexture *)> fn) {
  int id = next_++;
  watchers_[id] = std::move(fn);
  return id;
}

void Frames::unwatch(int id) {
  watchers_.erase(id);
}

namespace {

void unmapFrame(gpointer data) {
  auto *frame = static_cast<GstVideoFrame *>(data);
  gst_video_frame_unmap(frame);
  delete frame;
}

GstFlowReturn show(GstSample *sample, gpointer data) {
  auto &frames = *static_cast<std::shared_ptr<Frames> *>(data);
  if (!sample) {
    return GST_FLOW_EOS;
  }
  if (GdkTexture *texture = textureOfSample(sample)) {
    Frames::post(frames, texture);
  }
  gst_sample_unref(sample);
  return GST_FLOW_OK;
}

GstFlowReturn onFrame(GstAppSink *sink, gpointer data) {
  return show(gst_app_sink_pull_sample(sink), data);
}

// The frame a paused source stops on (its first, or where it was sought to), shown before it plays.
GstFlowReturn onPreroll(GstAppSink *sink, gpointer data) {
  return show(gst_app_sink_pull_preroll(sink), data);
}

} // namespace

GdkTexture *textureOfSample(GstSample *sample) {
  GstVideoInfo info;
  if (!gst_video_info_from_caps(&info, gst_sample_get_caps(sample)) || GST_VIDEO_INFO_FORMAT(&info) != GST_VIDEO_FORMAT_RGBA) {
    return nullptr;
  }
  auto *frame = new GstVideoFrame;
  if (!gst_video_frame_map(frame, &info, gst_sample_get_buffer(sample), GST_MAP_READ)) {
    delete frame;
    return nullptr;
  }
  // The texture holds the mapped frame, so the decoded buffer is shown without a copy.
  int stride = GST_VIDEO_FRAME_PLANE_STRIDE(frame, 0);
  GBytes *bytes = g_bytes_new_with_free_func(GST_VIDEO_FRAME_PLANE_DATA(frame, 0), static_cast<gsize>(stride) * GST_VIDEO_FRAME_HEIGHT(frame),
                                             unmapFrame, frame);
  GdkTexture *texture =
      gdk_memory_texture_new(GST_VIDEO_FRAME_WIDTH(frame), GST_VIDEO_FRAME_HEIGHT(frame), GDK_MEMORY_R8G8B8A8, bytes, stride);
  g_bytes_unref(bytes);
  return texture;
}

GstElement *makeFrameSink(const std::shared_ptr<Frames> &frames, bool sync) {
  GstElement *sink = gst_element_factory_make("appsink", nullptr);
  if (!sink) {
    return nullptr;
  }
  // A player's frames in square pixels, which its video chain scales an anamorphic source to, so
  // the texture's size is the picture's shape.
  GstCaps *caps = gst_caps_from_string(sync ? "video/x-raw,format=RGBA,pixel-aspect-ratio=1/1" : "video/x-raw,format=RGBA");
  g_object_set(sink, "caps", caps, "sync", sync ? TRUE : FALSE, "max-buffers", 2, "drop", TRUE, nullptr);
  gst_caps_unref(caps);
  GstAppSinkCallbacks callbacks{};
  callbacks.new_sample = onFrame;
  callbacks.new_preroll = onPreroll;
  gst_app_sink_set_callbacks(GST_APP_SINK(sink), &callbacks, new std::shared_ptr<Frames>(frames),
                             [](gpointer data) { delete static_cast<std::shared_ptr<Frames> *>(data); });
  return sink;
}

} // namespace ngn::gtk
