// The OS half of `<expo-camera>` and NgNativeCamera (the core's camera.h): AVFoundation's video
// permission and devices, and a capture session with a photo output. The view that shows the
// session's preview is in camera-view.h.
#pragma once

#include "ngn/camera.h"

#import <AVFoundation/AVFoundation.h>

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<CameraHardware> makeCameraHardware();

// The camera a view facing `facing` uses: the built-in one, else the first there is; nil on a Mac
// with none.
AVCaptureDevice *cameraFor(const std::string &facing);

// A running capture session on `device`, or null with `error` set: never without the camera
// allowed, so it never prompts.
class SessionCapture : public CameraCapture {
 public:
  virtual AVCaptureSession *session() const = 0;
  virtual void stop() = 0;
};
std::shared_ptr<SessionCapture> startCapture(AVCaptureDevice *device, std::string &error);

} // namespace ngn::appkit
