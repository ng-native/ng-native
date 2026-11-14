// `<expo-camera>` on a desktop host: expo-camera's view (ViewManagerAdapter_ExpoCamera) as a
// Fabric component of the desktop's own, and NgNativeCamera, the module @ng-native/expo's Camera
// calls the view's functions through, by the view's tag, over a CameraHardware the AppKit backend
// implements with AVFoundation.
//
// - getCameraPermissionsAsync(), requestCameraPermissionsAsync(): expo's permission response. Only
//   an undetermined permission is asked, and only when the app's Info.plist explains why; with
//   `noPrompts` (NGN_NO_PROMPTS=1) nothing is.
// - isAvailableAsync(): whether the Mac has a camera.
// - takePicture(tag, options): expo's picture, {uri, width, height, format: 'jpg', base64?}, a
//   JPEG at `quality` in `<caches>/Camera`, from the view `tag` once its camera runs.
// - record(tag, options), stopRecording(tag): refused; macOS records nothing yet.
//
// A view starts its camera when it mounts with the camera allowed and present: it sends
// `cameraReady`, and `mountError` ({message}, expo-camera's words) when the permission is not
// granted or the Mac has no camera. It asks for the permission first when it can.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/native-module.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace ngn {

extern const char CameraComponentName[];

class CameraProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  CameraProps() = default;
  CameraProps(
      const facebook::react::PropsParserContext &context,
      const CameraProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // back or front: on a Mac, the built-in camera either way, or the first one there is.
  std::string facing{"back"};
  bool active{true};
  bool mirror{false};
};

using CameraShadowNode = facebook::react::ConcreteViewShadowNode<CameraComponentName, CameraProps, facebook::react::ViewEventEmitter>;
using CameraComponentDescriptor = facebook::react::ConcreteComponentDescriptor<CameraShadowNode>;

class CameraHardware {
 public:
  enum class Access { NotDetermined, Denied, Restricted, Granted };
  virtual ~CameraHardware() = default;
  virtual Access access() = 0;
  // Shows the OS's prompt and answers once the user decides; answers the access as it is, with no
  // prompt, when the app's Info.plist gives no reason to ask. Any thread.
  virtual void requestAccess(std::function<void(Access)> done) = 0;
  virtual bool hasCamera() = 0;
};

// A view's running camera.
class CameraCapture {
 public:
  virtual ~CameraCapture() = default;
  // Writes a JPEG at `quality` (0 to 1) to `path`; answers its size, or why not. Any thread.
  virtual void takePicture(double quality, const std::string &path, std::function<void(int width, int height, const std::string &error)> done) = 0;
};

// The running cameras by view tag, shared by the views and NgNativeCamera. Any thread.
class CameraViews {
 public:
  void attach(int tag, std::shared_ptr<CameraCapture> capture);
  void detach(int tag);
  std::shared_ptr<CameraCapture> find(int tag) const;

 private:
  mutable std::mutex mutex_;
  std::map<int, std::shared_ptr<CameraCapture>> captures_;
};

// What a view does as it mounts: ask for the permission, start the camera, or report why not.
enum class CameraMount { Ask, Start, NotPermitted, NoCamera };
CameraMount cameraMount(CameraHardware::Access access, bool hasCamera, bool noPrompts);
// expo-camera's mountError message for a mount that cannot start, or empty.
std::string cameraMountError(CameraMount mount);

std::shared_ptr<NativeModule> makeCameraModule(
    std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts);

} // namespace ngn
