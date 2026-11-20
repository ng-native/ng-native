// The OS half of NgNativeVideo on Linux (the core's video.h), and `<expo-video>`'s view, over
// GStreamer and GTK.
//
// Each player is a `playbin3` per source (gst-playback.h) whose video goes to the views showing it
// as textures (gst-frames.h).
//
// The view is a GtkPicture with its content fit, under controls of our own (play and pause, the
// position, and full screen) when `nativeControls` is on, since GTK has no player view. Full
// screen opens a window of its own over the same frames, asked to go full screen: under a window
// manager that will not (or with none, as under Xvfb) it stays a window, and it is still left with
// Escape or by closing it. A view unmounted while its video is full screen closes that window.
// Picture in picture is absent.
#pragma once

#include "view-widget.h"

#include "ngn/video.h"

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// Null when GStreamer, playbin3 or appsink is not installed. `audioSink` is the audio sink's
// factory name, empty for GStreamer's own choice.
std::shared_ptr<VideoOutput> makeVideoOutput(std::string audioSink = "");

// `<expo-video>`'s widget in a view: fills `view` and shows what its props say. `events` gets
// expo-video's view events by name (firstFrameRender, fullscreenEnter, fullscreenExit).
struct VideoSurface;
std::shared_ptr<VideoSurface> makeVideoSurface(GtkWidget *view, std::function<void(const std::string &)> events);
void applyVideoSurface(VideoSurface &surface, const VideoViewModel &model);
// Enters or leaves full screen, as the button does.
void setVideoFullscreen(VideoSurface &surface, bool on);
// The window full screen opened, or null.
GtkWindow *videoFullscreenWindow(VideoSurface &surface);
// The picture the view shows its player's frames in.
GtkPicture *videoPicture(VideoSurface &surface);
// The view's play and pause button, or null without controls.
GtkWidget *videoPlayButton(VideoSurface &surface);
// The widget that fills the view.
GtkWidget *videoWidget(VideoSurface &surface);

} // namespace ngn::gtk
