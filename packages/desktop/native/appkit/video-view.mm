#import "video-view.h"

#import "video.h"

@implementation NGNVideoView {
  NGNVideoSurface *_surface;
}

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    __weak NGNVideoView *weakSelf = self;
    _surface = [[NGNVideoSurface alloc] initWithFrame:self.bounds
                                               events:[weakSelf](const std::string &name) { [weakSelf send:name]; }];
    _surface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_surface];
  }
  return self;
}

- (void)dealloc {
  [_surface detach];
}

- (void)send:(const std::string &)name {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent(name, folly::dynamic::object(), facebook::react::RawEvent::Category::Discrete);
  }
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  if (auto video = std::dynamic_pointer_cast<const ngn::VideoViewProps>(props)) {
    [_surface apply:ngn::videoViewModel(video->values)];
  }
}

- (void)layout {
  [super layout];
  _surface.frame = self.bounds;
}

@end
