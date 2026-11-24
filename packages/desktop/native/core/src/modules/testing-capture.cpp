#include "ngn/testing-capture.h"

#include "ngn/bytes.h"

namespace ngn {

namespace {

WindowCapture::Done answer(JsPromise promise) {
  return [promise = std::move(promise)](std::string png, std::string error) {
    if (!error.empty()) {
      promise.reject(error);
    } else {
      promise.resolve(base64Encode(png));
    }
  };
}

double number(const folly::dynamic &object, const char *key) {
  auto value = object.getDefault(key, 0);
  return value.isNumber() ? value.asDouble() : 0;
}

} // namespace

std::shared_ptr<NativeModule> makeTestingModule(std::shared_ptr<WindowCapture> capture) {
  struct Testing : NativeModule {
    explicit Testing(std::shared_ptr<WindowCapture> capture) : NativeModule("NgNativeTesting") {
      promise("capture", [capture](const folly::dynamic &args, JsPromise promise) {
        std::optional<WindowCapture::Region> region;
        if (!args.empty() && args[0].isObject()) {
          const auto &r = args[0];
          region = WindowCapture::Region{number(r, "x"), number(r, "y"), number(r, "width"), number(r, "height")};
        }
        capture->capture(region, answer(std::move(promise)));
      });
      promise("captureView", [capture](const folly::dynamic &args, JsPromise promise) {
        if (args.empty() || !args[0].isNumber()) {
          promise.reject("captureView needs a view's tag");
          return;
        }
        capture->captureView(static_cast<int64_t>(args[0].asDouble()), answer(std::move(promise)));
      });
    }
  };
  return std::make_shared<Testing>(std::move(capture));
}

} // namespace ngn
