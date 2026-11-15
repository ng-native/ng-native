// `<expo-image>`'s view on macOS: an NGNView that loads the source that fits it through the core
// (loadImageBytes, its ImageCache), shows the placeholder until the image arrives, decodes off the
// main thread, draws with expo-image-drawing.h, and sends expo-image's events.
#pragma once

#import "host-view.h"

#include "ngn/expo-image.h"

#include <memory>

@interface NGNExpoImageView : NGNView
// Set once by the host: where every image view reads its bytes from.
+ (void)useHttp:(std::shared_ptr<ngn::Http>)http cache:(std::shared_ptr<ngn::ImageCache>)cache;
@end
