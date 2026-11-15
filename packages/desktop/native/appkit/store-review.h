// The OS half of NgNativeStoreReview (the core's store-review.h): SKStoreReviewController.
#pragma once

#include "ngn/store-review.h"

#include <memory>

namespace ngn::appkit {

// The rating prompt in a Mac App Store build; null in any other.
std::shared_ptr<ReviewPrompt> makeReviewPrompt(bool appStoreBuild);

} // namespace ngn::appkit
