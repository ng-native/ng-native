// The OS half of NgNativeVideo (the core's video.h) and expo-video's view, with no Fabric in them:
// each player is an AVPlayer, found by its id while it lives, and NGNVideoSurface shows one in an
// AVPlayerView with expo-video's iOS view props.
//
// AVKit's full screen moves the AVPlayerView out of the surface into a window of its own, and back
// on exit. The surface never takes it back or sets its frame while it is away, and a surface taken
// out of the app (`detach`) while its video is full screen leaves the video showing until the user
// exits, then lets the player go.
#pragma once

#include "ngn/video.h"

#import <AVKit/AVKit.h>
#import <AppKit/AppKit.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<VideoOutput> makeVideoOutput();

} // namespace ngn::appkit

// The AVPlayer of the live player `id`, or nil.
AVPlayer *NGNVideoPlayerFor(int id);

@interface NGNVideoSurface : NSView <AVPlayerViewDelegate, AVPlayerViewPictureInPictureDelegate>
// `events` gets expo-video's view events by name: firstFrameRender, fullscreenEnter, fullscreenExit,
// pictureInPictureStart and pictureInPictureStop.
- (instancetype)initWithFrame:(NSRect)frame events:(std::function<void(const std::string &)>)events;
@property(readonly) AVPlayerView *playerView;
@property(readonly) BOOL fullScreen;
- (void)apply:(const ngn::VideoViewModel &)model;
// The view left the app: no more events, and the player goes once the video is not full screen.
- (void)detach;
@end
