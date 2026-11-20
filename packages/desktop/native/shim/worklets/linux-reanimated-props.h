// Force-included into Reanimated's shared C++ on Linux (cmake/libraries/react-native-reanimated.cmake).
// Its PlatformDepMethodsHolder.h declares the function that updates a view's props without a
// commit for Android and Apple only. The desktop's glue (core/src/libraries/react-native-reanimated.cpp)
// gives it Apple's form on every OS. The header declares none on Linux, so this one is the
// holder's. Reanimated calls it on neither OS, as Apple's IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS is off.
#pragma once

#include <folly/dynamic.h>

#include <functional>

namespace reanimated {
using SynchronouslyUpdateUIPropsFunction = std::function<void(const int, const folly::dynamic &)>;
} // namespace reanimated
