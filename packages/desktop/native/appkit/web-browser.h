// The OS half of NgNativeWebBrowser (the core's web-browser.h): ASWebAuthenticationSession.
#pragma once

#include "ngn/web-browser.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<AuthSession> makeAuthSession();

} // namespace ngn::appkit
