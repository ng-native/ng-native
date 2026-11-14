// The OS half of NgNativeLocalAuthentication (the core's local-authentication.h): LAContext.
#pragma once

#include "ngn/local-authentication.h"

#include <memory>

namespace ngn::appkit {

// With `noPrompts` (NGN_NO_PROMPTS=1, or a test launch's fake system UI) no prompt is ever shown: an
// evaluation fails at once as not_interactive, so an automated run never waits on a dialog nobody
// can answer.
std::shared_ptr<Authenticator> makeAuthenticator(bool noPrompts);

} // namespace ngn::appkit
