// `<expo-camera>` on a desktop host: expo-camera's view (ViewManagerAdapter_ExpoCamera) as a
// Fabric component of the desktop's own, and NgNativeCamera, the module @ng-native/expo's Camera
// calls the view's functions through, by the view's tag, over a CameraHardware the AppKit backend
// implements with AVFoundation.
//
// - getCameraPermissionsAsync(), requestCameraPermissionsAsync(): expo's permission response. Only
//   an undetermined permission is asked, and only when the app's Info.plist explains why; with
//   `noPrompts` (NGN_NO_PROMPTS=1) nothing is.
// - isAvailableAsync(): whether the Mac has a camera.
// - takePicture(tag, options): expo's picture, {uri, width, height, format, base64?}, in
//   `<caches>/Camera`, from the view `tag` once its camera runs: a JPEG at `quality`, or with
//   `imageType: 'png'` a PNG (lossless, so `quality` does nothing), as on iOS. Another imageType
//   is refused.
// - record(tag, options): expo's recording, {uri}, a QuickTime movie in `<caches>/Camera` from the
//   view `tag`, once it stops: stopRecording(tag), `maxDuration` seconds or `maxFileSize` bytes
//   reached, or the view going. It has sound unless the view has `mute`, and only with the
//   microphone allowed (as on iOS, a recording without the microphone permission has none; nothing
//   is asked). The view's `mute` as the recording starts holds until it stops; like iOS, record()
//   takes no `mute` of its own. One recording a view at a time.
//
// A view starts its camera when it mounts with the camera allowed and present: it sends
// `cameraReady`, and `mountError` ({message}, expo-camera's words) when the permission is not
// granted or the Mac has no camera. It asks for the permission first when it can.
#pragma once

#include "ngn/audio.h"
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
#include <optional>
#include <set>
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
  // expo-camera's `mute`: the view records without sound.
  bool mute{false};
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

// What a picture is asked for.
struct CameraPictureRequest {
  std::string path;
  // 0 to 1, for a JPEG.
  double quality{1};
  // expo-camera's PictureFormat: "jpg" or "png".
  std::string format{"jpg"};
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
  // The session preset the movie is recorded at, AVFoundation's name for it without its prefix
  // (High, Medium, Low, 640x480, iFrame1280x720, iFrame960x540); empty for High.
  std::string preset;
};

// A view's running camera.
class CameraCapture {
 public:
  virtual ~CameraCapture() = default;
  // Writes the picture `request` asks for; answers its size, or why not. Any thread.
  virtual void takePicture(const CameraPictureRequest &request, std::function<void(int width, int height, const std::string &error)> done) = 0;
  // Records a movie until stopRecording or a limit; `done` gets why not, or empty once the file
  // is finished. Any thread.
  virtual void startRecording(const CameraRecordingRequest &request, std::function<void(const std::string &error)> done) = 0;
  virtual void stopRecording() = 0;
  virtual bool recording() const = 0;
};

// The running cameras by view tag, and the views with `mute`, shared by the views and
// NgNativeCamera. A view sets its `mute` as its props change; detaching forgets both. Any thread.
class CameraViews {
 public:
  void attach(int tag, std::shared_ptr<CameraCapture> capture);
  void detach(int tag);
  // With `muted`, also whether the view has `mute`, read under the same lock, so a view that
  // detaches meanwhile cannot leave its camera without its mute.
  std::shared_ptr<CameraCapture> find(int tag, bool *muted = nullptr) const;
  void mute(int tag, bool muted);
  bool muted(int tag) const;

 private:
  mutable std::mutex mutex_;
  std::map<int, std::shared_ptr<CameraCapture>> captures_;
  std::set<int> muted_;
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
// `asked` is a view that has asked once already: a request that left the permission undetermined
// (an app with no camera usage string, which the OS never prompts for) is not asked again.
enum class CameraMount { Ask, Start, NotPermitted, NoCamera };
CameraMount cameraMount(CameraHardware::Access access, bool hasCamera, bool noPrompts, bool asked = false);
// expo-camera's mountError message for a mount that cannot start, or empty.
std::string cameraMountError(CameraMount mount);

// A picture the host's camera sheet took: its size, and the camera's EXIF (an object, or null).
struct CameraShot {
  int width{0};
  int height{0};
  folly::dynamic exif{nullptr};
};

// A movie the host's camera sheet recorded: its size as it plays, and its length in milliseconds.
struct CameraClip {
  int width{0};
  int height{0};
  double duration{0};
};

// What the sheet is asked for: a photo, a video, or either, with a switch between them.
struct CameraSheetRequest {
  bool photos{true};
  bool videos{false};
  CameraPictureRequest photo;
  CameraRecordingRequest video;
};

// What the sheet took: a photo or a video, or neither when the user cancelled.
struct CameraTake {
  std::optional<CameraShot> photo;
  std::optional<CameraClip> video;
};

// The host's own camera for expo-image-picker's launchCameraAsync: macOS has no system camera
// screen like iOS's UIImagePickerController, so the host shows the camera's preview and a shutter
// itself.
class CameraSheet {
 public:
  virtual ~CameraSheet() = default;
  // Shows the camera; once the user takes a photo or records a video, writes it as `request` asks
  // and answers it. Answers neither and no error when they cancel or there is no window to show it
  // on, and an error when the camera fails. Only with the camera allowed and present. Any thread.
  virtual void shoot(const CameraSheetRequest &request, std::function<void(CameraTake, const std::string &error)> done) = 0;
};

// What NgNativeImagePicker's camera half needs: the permission and the device, the microphone a
// video's sound comes from, the sheet, and the folder its photos and videos go in
// (`<caches>/ImagePicker`, as on iOS).
struct PickerCamera {
  std::shared_ptr<CameraHardware> hardware;
  std::shared_ptr<AudioInput> microphone;
  std::shared_ptr<CameraSheet> sheet;
  std::string folder;
};

// expo's camera permission response, asked as NgNativeCamera asks it: only when undetermined, and
// never with `noPrompts`.
folly::dynamic cameraPermissionOf(CameraHardware::Access access);
void requestCameraPermission(CameraHardware &hardware, bool noPrompts, JsPromise promise);

// What expo-image-picker's mediaTypes (a MediaType, a list of them, or the deprecated
// MediaTypeOptions) ask for. As on iOS, live photos are photos, and a request that names neither
// photos nor videos (left out, or an empty list) takes photos.
struct MediaKinds {
  bool photos{false};
  bool videos{false};
};
MediaKinds mediaKindsOf(const folly::dynamic &options);

// expo-image-picker's launchCameraAsync(options) over `camera`, shaped as iOS shapes a camera
// shot (no assetId and no fileName):
// - a photo, a JPEG at `quality` (1 by default), with base64 and exif only when asked;
// - with `mediaTypes` asking for videos, a QuickTime movie (`video/quicktime`) recorded at
//   `videoQuality` (UIImagePickerControllerQualityType, High by default) for at most
//   `videoMaxDuration` seconds (0, the default, for no limit), with its duration in milliseconds.
//   Videos alone show a record button; videos and photos, a switch between the two.
// Rejected without the camera permission, as iOS does, or on a Mac with no camera. A request for
// videos asks for the microphone when it is undetermined; refused, the video has no sound, as iOS's
// camera records it. Only an app that cannot ask (no NSMicrophoneUsageDescription) is rejected,
// with iOS's message. Canceled with `noPrompts`, which shows no sheet.
void launchPickerCamera(const PickerCamera &camera, bool noPrompts, const folly::dynamic &options, JsPromise promise);

std::shared_ptr<NativeModule> makeCameraModule(
    std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts);

} // namespace ngn
