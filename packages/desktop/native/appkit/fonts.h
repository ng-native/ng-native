// The OS half of NgNativeFont (the core's fonts.h): CTFontManager, registering for this process.
#pragma once

#include "ngn/fonts.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<FontRegistrar> makeFontRegistrar();

} // namespace ngn::appkit
