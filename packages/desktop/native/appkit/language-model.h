// The OS half of NgNativeLocalLlm (the core's language-model.h): Apple's Foundation Models on macOS
// 26 and later, through the C interface language-model.swift exports. On an older macOS the
// availability is notEligible and no session is made.
#pragma once

#include "ngn/language-model.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<LanguageModelEngine> makeLanguageModelEngine();

} // namespace ngn::appkit
