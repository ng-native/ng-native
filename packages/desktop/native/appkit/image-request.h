// What an Image asks for (image-view.h): the source whose scale is nearest the screen's, and the
// request it is loaded with, its method, headers and body included.
#pragma once

#import <Foundation/Foundation.h>

#include <react/renderer/imagemanager/primitives.h>

#include <optional>
#include <vector>

namespace ngn::appkit {

// The source with a uri whose scale is nearest `screenScale`, as React Native iOS picks, or none.
std::optional<facebook::react::ImageSource> pickImageSource(
    const std::vector<facebook::react::ImageSource> &sources, double screenScale);
// Whether two sources load the same thing: ImageSource's own == compares only the uri.
bool sameImageRequest(const facebook::react::ImageSource &a, const facebook::react::ImageSource &b);
// The request for `url`, which the source's uri gave, with the source's method, headers and body.
NSURLRequest *imageRequest(NSURL *url, const facebook::react::ImageSource &source);

} // namespace ngn::appkit
