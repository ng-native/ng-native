#import "modal-host-view.h"

#import "surface-view.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {
ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gPresentationChanged;
} // namespace

@class NGNModalHostView;

// The cover: a container of its own that takes Escape.
@interface NGNModalCover : NGNSurfaceView
@property (nonatomic, weak) NGNModalHostView *modal;
@end

@interface NGNModalHostView ()
- (void)requestClose;
- (void)coverResized;
@end

@implementation NGNModalCover
- (BOOL)acceptsFirstResponder {
  return YES;
}
- (void)cancelOperation:(id)sender {
  [self.modal requestClose];
}
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  [self.modal coverResized];
}
@end

@implementation NGNModalHostView {
  NGNModalCover *_cover;
  State::Shared _modalState;
  NSSize _reportedSize;
}

+ (ngn::InputSink *)input {
  return gInput;
}
+ (void)setInput:(ngn::InputSink *)input {
  gInput = input;
}
+ (std::function<void(NSInteger, BOOL)>)presentationChanged {
  return gPresentationChanged;
}
+ (void)setPresentationChanged:(std::function<void(NSInteger, BOOL)>)fn {
  gPresentationChanged = std::move(fn);
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  // Yoga places the modal inside its parent; on screen it fills its cover.
  if (_cover != nil) {
    self.frame = _cover.bounds;
  }
}

- (void)updateState:(const State::Shared &)state {
  [super updateState:state];
  _modalState = state;
  _reportedSize = NSZeroSize;
  [self coverResized];
}

- (void)presentOver:(NSView *)parent {
  NSView *content = parent.window.contentView;
  if (content == nil || _cover != nil || gInput == nullptr) {
    return;
  }
  auto surfaceId = static_cast<SurfaceId>(self.surfaceId);
  _cover = [[NGNModalCover alloc] initWithFrame:content.bounds
                                      surfaceId:surfaceId
                                      container:static_cast<ngn::ContainerId>(self.reactTag)
                                        rootTag:static_cast<Tag>(self.reactTag)
                                          input:gInput];
  _cover.modal = self;
  _cover.wantsLayer = YES;
  _cover.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, YES);
  }
  [content addSubview:_cover];
  self.frame = _cover.bounds;
  [_cover addSubview:self];
  [_cover.window makeFirstResponder:_cover];
  [self coverResized];
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onShow({});
  }
}

- (void)dismiss {
  if (_cover == nil) {
    return;
  }
  [self removeFromSuperview];
  [_cover removeFromSuperview];
  _cover = nil;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, NO);
  }
}

- (void)coverResized {
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ModalHostViewState>>(_modalState);
  if (_cover == nil || !concrete) {
    return;
  }
  NSSize size = _cover.bounds.size;
  if (NSEqualSizes(size, _reportedSize)) {
    return;
  }
  _reportedSize = size;
  self.frame = _cover.bounds;
  concrete->updateState(ModalHostViewState({static_cast<Float>(size.width), static_cast<Float>(size.height)}));
}

- (void)requestClose {
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onRequestClose({});
  }
}

@end
