// `<expo-camera>`'s view on macOS: an NGNView showing its capture session through an
// AVCaptureVideoPreviewLayer, started as it mounts when the camera is allowed and present (the
// core's cameraMount), and registered with NgNativeCamera by its tag while it runs.
#pragma once

#import "host-view.h"

#include "ngn/camera.h"

#include <memory>

@interface NGNCameraView : NGNView
// Set once by the host.
+ (void)useHardware:(std::shared_ptr<ngn::CameraHardware>)hardware views:(std::shared_ptr<ngn::CameraViews>)views noPrompts:(bool)noPrompts;
@end
