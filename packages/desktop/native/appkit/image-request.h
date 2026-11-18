// The request an Image loads its source with (image-view.h), its method, headers and body included.
// Which source it loads is the core's (ngn/image-source.h).
#pragma once

#import <Foundation/Foundation.h>

#include <react/renderer/imagemanager/primitives.h>

namespace ngn::appkit {

// The request for `url`, which the source's uri gave, with the source's method, headers and body.
NSURLRequest *imageRequest(NSURL *url, const facebook::react::ImageSource &source);

} // namespace ngn::appkit
