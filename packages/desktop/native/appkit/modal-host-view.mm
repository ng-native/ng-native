#import "modal-host-view.h"

#import "surface-view.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {
ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gPresentationChanged;
std::function<NSView *(NSInteger)> gViewForTag;
NSHashTable *gPopovers = [NSHashTable weakObjectsHashTable];
// The most a popover measures its content against, before it fits.
constexpr CGFloat kPopoverMax = 640;
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

@interface NGNModalHostView () <NSPopoverDelegate>
@end

@implementation NGNModalHostView {
  NGNModalCover *_cover;
  NSPopover *_popover;
  BOOL _dismissing;
  State::Shared _modalState;
  NSSize _reportedSize;
}

+ (std::function<NSView *(NSInteger)>)viewForTag {
  return gViewForTag;
}
+ (void)setViewForTag:(std::function<NSView *(NSInteger)>)fn {
  gViewForTag = std::move(fn);
}

- (NSArray<NSView *> *)fabricChildrenOf:(NSView *)view {
  NSMutableArray *children = [NSMutableArray array];
  for (NSView *v in view.subviews) {
    if ([v isKindOfClass:NGNView.class] && !v.hidden) {
      [children addObject:v];
    }
  }
  return children;
}

+ (void)fitPopovers {
  for (NGNModalHostView *modal in gPopovers.allObjects) {
    [modal fitPopover];
  }
}

// The popover takes its content's size, once it has one: past the views that fill their parent
// (<modal>'s own container), the extent of what is in them.
- (void)fitPopover {
  if (_popover == nil) {
    return;
  }
  NSView *root = self;
  for (;;) {
    NSArray<NSView *> *children = [self fabricChildrenOf:root];
    if (children.count == 1 && NSEqualSizes(children[0].frame.size, root.bounds.size)) {
      root = children[0];
    } else {
      break;
    }
  }
  NSSize size = NSZeroSize;
  for (NSView *child in [self fabricChildrenOf:root]) {
    size.width = std::max(size.width, NSMaxX(child.frame));
    size.height = std::max(size.height, NSMaxY(child.frame));
  }
  if (size.width < 1 || size.height < 1 || NSEqualSizes(size, _popover.contentSize)) {
    return;
  }
  _popover.contentSize = size;
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
  NSView *anchor = self.desktopProps.anchor && gViewForTag ? gViewForTag(*self.desktopProps.anchor) : nil;
  if (anchor.window != nil) {
    [self presentPopoverAt:anchor];
    return;
  }
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

- (void)presentPopoverAt:(NSView *)anchor {
  if (_cover != nil || gInput == nullptr) {
    return;
  }
  NSSize window = anchor.window.contentView.bounds.size;
  NSRect frame = NSMakeRect(0, 0, std::min(window.width, kPopoverMax), std::min(window.height, kPopoverMax));
  _cover = [[NGNModalCover alloc] initWithFrame:frame
                                      surfaceId:static_cast<SurfaceId>(self.surfaceId)
                                      container:static_cast<ngn::ContainerId>(self.reactTag)
                                        rootTag:static_cast<Tag>(self.reactTag)
                                          input:gInput];
  _cover.modal = self;
  _cover.wantsLayer = YES;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, YES);
  }
  self.frame = _cover.bounds;
  [_cover addSubview:self];
  NSViewController *controller = [NSViewController new];
  controller.view = _cover;
  _popover = [NSPopover new];
  _popover.contentViewController = controller;
  _popover.contentSize = frame.size;
  _popover.behavior = NSPopoverBehaviorTransient;
  _popover.animates = NO;
  _popover.delegate = self;
  [gPopovers addObject:self];
  [self coverResized];
  [_popover showRelativeToRect:anchor.bounds ofView:anchor preferredEdge:NSRectEdgeMaxY];
  [_cover.window makeFirstResponder:_cover];
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onShow({});
  }
}

// Closed by AppKit (a click outside): the app decides, as for Escape.
- (void)popoverDidClose:(NSNotification *)note {
  if (!_dismissing) {
    [self requestClose];
  }
}

- (void)dismiss {
  if (_cover == nil) {
    return;
  }
  if (_popover != nil) {
    _dismissing = YES;
    [_popover close];
    _popover.contentViewController = nil;
    _popover = nil;
    [gPopovers removeObject:self];
    _dismissing = NO;
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
