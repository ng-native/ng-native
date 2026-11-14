#include "ngn/sharing.h"

#include <atomic>

namespace ngn {

namespace {

std::optional<std::string> field(const folly::dynamic &request, const char *key) {
  const auto *value = request.isObject() ? request.get_ptr(key) : nullptr;
  return value != nullptr && value->isString() && !value->asString().empty() ? std::optional(value->asString()) : std::nullopt;
}

} // namespace

std::shared_ptr<NativeModule> makeSharingModule(std::shared_ptr<SharePicker> picker) {
  struct Sharing : NativeModule {
    explicit Sharing(std::shared_ptr<SharePicker> picker) : NativeModule("NgNativeSharing") {
      auto showing = std::make_shared<std::atomic<bool>>(false);
      promise("share", [picker, showing](const folly::dynamic &args, JsPromise promise) {
        const folly::dynamic request = args.empty() ? folly::dynamic(nullptr) : args[0];
        SharePicker::Request content{.message = field(request, "message"), .url = field(request, "url"), .title = field(request, "title")};
        if (!content.message && !content.url) {
          promise.reject("Sharing.share: a request needs a message or a url");
          return;
        }
        if (showing->exchange(true)) {
          promise.reject("Sharing.share: the share picker is already showing");
          return;
        }
        picker->show(content, [promise, showing](std::optional<std::string> service) {
          showing->store(false);
          promise.resolve(
              service ? folly::dynamic::object("action", "sharedAction")("activityType", *service)
                      : folly::dynamic::object("action", "dismissedAction")("activityType", nullptr));
        });
      });
    }
  };
  return std::make_shared<Sharing>(std::move(picker));
}

} // namespace ngn
