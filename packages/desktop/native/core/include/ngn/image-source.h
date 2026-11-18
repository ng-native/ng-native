// Which of an Image's sources it loads, and whether a new one is a new load: the same on every
// toolkit, which then makes the request (appkit/image-request.h on macOS).
#pragma once

#include <react/renderer/imagemanager/primitives.h>

#include <optional>
#include <vector>

namespace ngn {

// The source with a uri whose scale is nearest `screenScale`, as React Native iOS picks, or none.
std::optional<facebook::react::ImageSource> pickImageSource(
    const std::vector<facebook::react::ImageSource> &sources, double screenScale);
// Whether two sources load the same thing: ImageSource's own == compares only the uri.
bool sameImageRequest(const facebook::react::ImageSource &a, const facebook::react::ImageSource &b);

} // namespace ngn
