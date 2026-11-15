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
// - record(tag, options): expo's recording, {uri}, a QuickTime movie in `<caches>/Camera` from the
//   view `tag`, once it stops: stopRecording(tag), `maxDuration` seconds or `maxFileSize` bytes
//   reached, or the view going. It has sound unless `mute`, and only with the microphone allowed
//   (as on iOS, a recording without the microphone permission has none; nothing is asked). One
//   recording a view at a time.
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
#include <vector>

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
  // Whether a recording can have sound: the microphone allowed, and one there. Never asks.
  virtual bool microphoneAllowed() = 0;
};

// What a recording is asked for.
struct CameraRecordingRequest {
  std::string path;
  // Seconds and bytes; 0 for no limit.
  double maxDuration{0};
  double maxFileSize{0};
  bool sound{true};
  // expo-camera's VideoCodec ("avc1", "hvc1", "jpeg", "apcn", "ap4h"), or empty for the default.
  std::string codec;
};

// A view's running camera.
class CameraCapture {
 public:
  virtual ~CameraCapture() = default;
  // Writes a JPEG at `quality` (0 to 1) to `path`; answers its size, or why not. Any thread.
  virtual void takePicture(double quality, const std::string &path, std::function<void(int width, int height, const std::string &error)> done) = 0;
  // Records a movie until stopRecording or a limit; `done` gets why not, or empty once the file
  // is finished. Any thread.
  virtual void startRecording(const CameraRecordingRequest &request, std::function<void(const std::string &error)> done) = 0;
  virtual void stopRecording() = 0;
  virtual bool recording() const = 0;
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

// A camera the host could start: the Mac's own, and whether it is suspended (a MacBook's with the
// lid closed, which is listed but gives no frames).
struct CameraCandidate {
  bool builtIn{false};
  bool suspended{false};
};
// The one to start, by index: the built-in camera, else the first other, never a suspended one;
// -1 when none gives frames.
int chooseCamera(const std::vector<CameraCandidate> &cameras);

// What a view does as it mounts: ask for the permission, start the camera, or report why not.
enum class CameraMount { Ask, Start, NotPermitted, NoCamera };
CameraMount cameraMount(CameraHardware::Access access, bool hasCamera, bool noPrompts);
// expo-camera's mountError message for a mount that cannot start, or empty.
std::string cameraMountError(CameraMount mount);

std::shared_ptr<NativeModule> makeCameraModule(
    std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts);

} // namespace ngn
