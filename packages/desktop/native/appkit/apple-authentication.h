// The OS half of NgNativeAppleAuthentication (the core's apple-authentication.h): AuthenticationServices'
// Apple ID provider and authorization controller.
#pragma once

#import <Foundation/Foundation.h>

#include "ngn/apple-authentication.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<AppleIdProvider> makeAppleIdProvider();

// Whether a value of the `com.apple.developer.applesignin` entitlement allows Sign in with Apple:
// an array naming `Default`.
bool allowsAppleSignIn(id entitlement);

} // namespace ngn::appkit
