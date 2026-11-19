// The OS half of `<expo-camera>`, NgNativeCamera and ImagePicker's camera on Linux (the core's
// camera.h), over the Camera portal and GStreamer.
//
// Access is the portal's AccessCamera, which asks once and remembers: until the app has asked in
// this run, access is not determined, and asking again answers at once with what was decided.
// Whether there is a camera is the portal's IsCameraPresent; with no Camera portal there is none.
// A running camera is `pipewiresrc` on the PipeWire connection the portal opens for the app, its
// frames shown as textures (gst-frames.h). A picture is the newest frame, written as a JPEG by
// gdk-pixbuf or a PNG by GDK. A recording is a second stream from the camera into a QuickTime
// movie, H.264 where an encoder is installed (x264 or OpenH264) and Motion JPEG otherwise, with
// AAC sound from the default microphone when it is allowed, an AAC encoder is installed and the
// view is not muted.
//
// `facing` and `mirror` do nothing: the portal offers the cameras as one.
#pragma once

#include "view-widget.h"

#include "ngn/audio.h"
#include "ngn/camera.h"

#include <gtk/gtk.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

struct CameraSetup {
  // The camera as a gst-launch description, granted and present; empty for the portal's.
  std::string source;
  // The microphone a recording's sound comes from, its access and presence.
  std::shared_ptr<AudioInput> microphone;
  // The microphone as a gst-launch description; empty for `pulsesrc`.
  std::string microphoneSource;
};

// Null when GStreamer has no `pipewiresrc` (or, with a source given, no `videoconvert`).
std::shared_ptr<CameraHardware> makeCameraHardware(CameraSetup setup);

// What the views and the sheet start cameras with, and whether they may ask: set once, as the
// host starts.
void useCameraHardware(std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, bool noPrompts);

// `<expo-camera>`'s picture in a view: starts and stops the camera as the view's props and the
// permission say, sending cameraReady with its first frame and mountError once when it cannot
// start. `send` gets each event and its payload.
struct CameraSurface;
std::shared_ptr<CameraSurface> makeCameraSurface(GtkWidget *view, int tag, std::function<void(const std::string &, folly::dynamic)> send);
void applyCameraSurface(CameraSurface &surface, const CameraProps &props);
GtkWidget *cameraWidget(CameraSurface &surface);
GtkPicture *cameraPicture(CameraSurface &surface);

// The host's camera screen for ImagePicker: a dialog over the front window with the preview,
// Cancel (Escape) and the shutter, and a Photo and Video switch for a request that takes either.
std::shared_ptr<CameraSheet> makeCameraSheet();
// The dialog the sheet shows now, or null; its shutter and cancel buttons, for the tests.
GtkWindow *cameraSheetWindow();
GtkWidget *cameraSheetShutter();
GtkWidget *cameraSheetCancel();

} // namespace ngn::gtk
