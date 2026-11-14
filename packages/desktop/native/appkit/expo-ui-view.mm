#import "expo-ui-view.h"

#include "expo-ui-renderer.h"

#include <react/renderer/core/ConcreteState.h>

#include <cmath>
#include <unordered_map>

using namespace facebook::react;

namespace {

// The RNHostViews mounted, by tag, for the SwiftUI content that holds them.
NSMapTable<NSNumber *, NGNView *> *embeddedViews() {
  static NSMapTable<NSNumber *, NGNView *> *views = [NSMapTable strongToWeakObjectsMapTable];
  return views;
}

} // namespace

@implementation NGNExpoUIView

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  // SwiftUI draws it, in its HostView's content.
  self.hidden = YES;
}

- (void)mountChild:(NGNView *)child index:(NSInteger)index {
}

- (void)unmountChild:(NGNView *)child {
}

@end

@implementation NGNExpoUIHostView {
  std::unique_ptr<ngn::appkit::ExpoUIRenderer> _renderer;
  std::unordered_map<Tag, SharedEventEmitter> _emitters;
  facebook::react::Size _reported;
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    __weak NGNExpoUIHostView *weakSelf = self;
    _renderer = std::make_unique<ngn::appkit::ExpoUIRenderer>(
        [weakSelf](Tag tag, const std::string &name, folly::dynamic payload) {
          [weakSelf send:name payload:std::move(payload) to:tag];
        },
        [](Tag tag) -> NSView * { return [embeddedViews() objectForKey:@(tag)]; });
    NSView *content = _renderer->view();
    content.frame = self.bounds;
    content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:content];
  }
  return self;
}

- (void)send:(const std::string &)name payload:(folly::dynamic)payload to:(Tag)tag {
  auto found = _emitters.find(tag);
  if (found != _emitters.end() && found->second) {
    found->second->dispatchEvent(name, std::move(payload), RawEvent::Category::Discrete);
  }
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self reportContentSize];
}

// Its children are SwiftUI's to draw.
- (void)mountChild:(NGNView *)child index:(NSInteger)index {
}

- (void)unmountChild:(NGNView *)child {
}

- (void)setTree:(std::shared_ptr<const ngn::ExpoUINode>)tree {
  _emitters = tree ? ngn::appkit::expoUIEmitters(*tree) : decltype(_emitters){};
  _renderer->setTree(std::move(tree));
  [self reportContentSize];
}

// Tells layout the content's size on the axes the HostView matches, as expo/ui's setViewSize does.
- (void)reportContentSize {
  auto props = std::dynamic_pointer_cast<const ngn::ExpoUIProps>(self.props);
  auto state = std::dynamic_pointer_cast<const ConcreteState<ngn::ExpoUIState>>(self.state);
  if (!props || !state || !_renderer->tree() || (!props->matchContentsHorizontal && !props->matchContentsVertical)) {
    return;
  }
  const auto &frame = self.layoutMetrics.frame.size;
  auto size = _renderer->fit(props->matchContentsHorizontal ? -1 : frame.width, props->matchContentsVertical ? -1 : frame.height);
  size = {std::ceil(size.width), std::ceil(size.height)};
  if (size == _reported || size == state->getData().contentSize) {
    return;
  }
  _reported = size;
  state->updateState(ngn::ExpoUIState{.contentSize = size});
}

@end

@implementation NGNExpoUIEmbeddedView

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    [embeddedViews() setObject:self forKey:@(view.tag)];
  }
  return self;
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  // Where it is in the SwiftUI content is SwiftUI's to say; its size is Yoga's.
  [self setFrameOrigin:NSZeroPoint];
  [self.superview invalidateIntrinsicContentSize];
}

@end

NGNView *NGNMakeExpoUIView(const ShadowView &view) {
  auto name = ngn::expoUIViewName(view.componentName);
  if (!name) {
    return nil;
  }
  if (*name == "HostView") {
    return [[NGNExpoUIHostView alloc] initWithShadowView:view];
  }
  if (*name == "RNHostView") {
    return [[NGNExpoUIEmbeddedView alloc] initWithShadowView:view];
  }
  return [[NGNExpoUIView alloc] initWithShadowView:view];
}
