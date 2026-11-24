// NgNativeTesting: what @ng-native/testing's device tests call to see the app, as its iOS and
// Android modules are, over a WindowCapture the host implements by drawing its own window, in
// process, so no screen recording permission is asked.
//
// - capture(region): a PNG, in base64, of the app's window, or of the region of it given in
//   points, `{ x, y, width, height }`, or null for all of it.
// - captureView(tag): a PNG, in base64, of the part of the window the view with that tag covers.
//
// Each rejects with the backend's reason when there is nothing to capture.
#pragma once

#include "ngn/native-module.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

class WindowCapture {
 public:
  struct Region {
    double x{0};
    double y{0};
    double width{0};
    double height{0};
  };
  // The PNG's bytes, or an error. `done` on any thread, once.
  using Done = std::function<void(std::string png, std::string error)>;
  virtual ~WindowCapture() = default;
  // The app's window, or the region of it in points.
  virtual void capture(std::optional<Region> region, Done done) = 0;
  // The part of the window the view with this tag covers.
  virtual void captureView(int64_t tag, Done done) = 0;
};

std::shared_ptr<NativeModule> makeTestingModule(std::shared_ptr<WindowCapture> capture);

} // namespace ngn
