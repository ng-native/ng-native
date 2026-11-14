// The OS half of NgNativeLocalAuthentication (the core's local-authentication.h): LAContext.
#pragma once

#include "ngn/local-authentication.h"

#include <memory>

namespace ngn::appkit {

// With NGN_NO_PROMPTS=1 in the environment no prompt is ever shown: an evaluation fails at once as
// not_interactive, so an automated run never waits on a dialog nobody can answer.
std::shared_ptr<Authenticator> makeAuthenticator();

} // namespace ngn::appkit
