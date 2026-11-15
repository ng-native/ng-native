#include "store-review.h"

#import <StoreKit/StoreKit.h>

// SKStoreReviewController's class method is the one Objective-C call for it on macOS; its
// replacement (AppStore.requestReview) is Swift only.
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace ngn::appkit {

namespace {

class AppStorePrompt final : public ReviewPrompt {
 public:
  void request() override {
    dispatch_async(dispatch_get_main_queue(), ^{
      [SKStoreReviewController requestReview];
    });
  }
};

} // namespace

std::shared_ptr<ReviewPrompt> makeReviewPrompt(bool appStoreBuild) {
  return appStoreBuild ? std::make_shared<AppStorePrompt>() : nullptr;
}

} // namespace ngn::appkit
