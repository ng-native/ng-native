#include "ngn/store-review.h"

namespace ngn {

std::shared_ptr<NativeModule> makeStoreReviewModule(std::shared_ptr<ReviewPrompt> prompt, bool noPrompts) {
  struct StoreReview : NativeModule {
    StoreReview(std::shared_ptr<ReviewPrompt> prompt, bool noPrompts) : NativeModule("NgNativeStoreReview") {
      bool available = prompt != nullptr;
      promise("isAvailableAsync", [available](const folly::dynamic &, JsPromise promise) { promise.resolve(available); });
      promise("hasAction", [available](const folly::dynamic &, JsPromise promise) { promise.resolve(available); });
      promise("requestReview", [prompt, noPrompts](const folly::dynamic &, JsPromise promise) {
        if (prompt && !noPrompts) {
          prompt->request();
        }
        promise.resolve(nullptr);
      });
      sync("storeUrl", [](const folly::dynamic &) { return folly::dynamic(nullptr); });
    }
  };
  return std::make_shared<StoreReview>(std::move(prompt), noPrompts);
}

} // namespace ngn
