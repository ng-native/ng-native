// The AppKit half of remote notifications (the core's PushTokens): registration through NSApp,
// whose answers come to the app delegate, and an APNs payload as the core reads it.
#pragma once

#import <Foundation/Foundation.h>

#include "ngn/notifications.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<PushRegistrar> makePushRegistrar();

// A notification's userInfo as JSON: what JSON can say (strings, numbers, booleans, null, arrays
// and dictionaries with string keys), with anything else left out.
folly::dynamic pushPayload(NSDictionary *userInfo);

} // namespace ngn::appkit
