// `<expo-video>`'s view on macOS: an NGNView holding an NGNVideoSurface (video.h), which shows the
// player its `player` prop names and sends expo-video's view events to the view's emitter.
#pragma once

#import "host-view.h"

#include "ngn/video.h"

@interface NGNVideoView : NGNView
@end
