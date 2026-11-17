// The OS half of `<expo-camera>` and NgNativeCamera (the core's camera.h): AVFoundation's video
// permission and devices, and a capture session with a photo output. The view that shows the
// session's preview is in camera-view.h.
#pragma once

#include "ngn/camera.h"

#import <AVFoundation/AVFoundation.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<CameraHardware> makeCameraHardware();

// Writes `image` to the request's path as its format asks: a JPEG at its quality, or a PNG.
bool writePicture(CGImageRef image, const CameraPictureRequest &request);

// The camera a view facing `facing` uses: the built-in one, else the first there is; nil on a Mac
// with none.
AVCaptureDevice *cameraFor(const std::string &facing);

// A capture session with a photo output. Starting and stopping run on a queue of the capture's
// own, since AVCaptureSession's startRunning and stopRunning block while the camera comes up or
// goes down, which can take a second (a Continuity Camera longer).
// A still's image (owned by the capture, valid during the call) and the camera's metadata, or
// a null image and why. On whatever thread the photo output answers on.
using PhotoDone = std::function<void(CGImageRef image, NSDictionary *metadata, const std::string &error)>;

class SessionCapture : public CameraCapture {
 public:
  virtual AVCaptureSession *session() const = 0;
  // Takes a still from the running session.
  virtual void capturePhoto(PhotoDone done) = 0;
  // A still written as `request` asks (writePicture).
  void takePicture(const CameraPictureRequest &request, std::function<void(int, int, const std::string &)> done) final;
  // Starts the session, then calls `running` on the main thread.
  virtual void start(std::function<void()> running) = 0;
  // Stops it, without waiting. Going away stops it too.
  virtual void stop() = 0;
};
// A capture session on `device`, started (`running` is called on the main thread once it is), or
// null with `error` set: never without the camera allowed, so it never prompts.
std::shared_ptr<SessionCapture> startCapture(AVCaptureDevice *device, std::string &error, std::function<void()> running);
// The capture over a session already configured, not yet started.
std::shared_ptr<SessionCapture> sessionCapture(AVCaptureSession *session, AVCapturePhotoOutput *output);

} // namespace ngn::appkit
