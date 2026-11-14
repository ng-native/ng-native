// NgNativeStoreReview: what @ng-native/expo's StoreReview calls on expo-store-review. A Mac app
// can ask for a rating only from the Mac App Store, so in a `mas` build the host has a
// ReviewPrompt (SKStoreReviewController) and anywhere else none, and the module is inert:
//
// - isAvailableAsync(), hasAction(): whether there is a prompt to show.
// - requestReview(): asks the system to show its rating prompt, which it may decline to. Nothing
//   without a prompt, or with `noPrompts` (NGN_NO_PROMPTS=1).
// - storeUrl(): null. A Mac app's store page is not in its config, so Updates opens none either.
#pragma once

#include "ngn/native-module.h"

#include <memory>

namespace ngn {

class ReviewPrompt {
 public:
  virtual ~ReviewPrompt() = default;
  virtual void request() = 0;
};

// `prompt` is null outside a Mac App Store build.
std::shared_ptr<NativeModule> makeStoreReviewModule(std::shared_ptr<ReviewPrompt> prompt, bool noPrompts);

} // namespace ngn
