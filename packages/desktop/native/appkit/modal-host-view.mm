#import "modal-host-view.h"
#import "undo.h"
#import "screen-capture.h"

#import "surface-view.h"

#include "ngn/desktop-modal.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {
ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gPresentationChanged;
std::function<NSView *(NSInteger)> gViewForTag;
std::function<NSSize(NSInteger, NSInteger, NSSize)> gSheetSizer;
std::function<NSSize(NSInteger, NSInteger, NSSize)> gPopoverSizer;
NSHashTable *gPopovers = [NSHashTable weakObjectsHashTable];
constexpr CGFloat kPopoverMax = ngn::kPopoverMax;
} // namespace

@class NGNModalHostView;

// The cover: a container of its own that takes Escape.
@interface NGNModalCover : NGNSurfaceView
@property (nonatomic, weak) NGNModalHostView *modal;
@end

@interface NGNModalHostView ()
- (void)coverResized;
@end

@implementation NGNModalCover
- (BOOL)acceptsFirstResponder {
  return YES;
}
- (void)cancelOperation:(id)sender {
  [self.modal requestClose];
}
// Cmd-W closes the sheet or cover in front before its window.
- (void)performClose:(id)sender {
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
  NSWindow *_sheet;
  BOOL _dismissing;
  // The window a popover measures against: its anchor's.
  NSSize _anchorWindowSize;
  State::Shared _modalState;
  NSSize _reportedSize;
}

+ (std::function<NSSize(NSInteger, NSInteger, NSSize)>)sheetSizer {
  return gSheetSizer;
}
+ (void)setSheetSizer:(std::function<NSSize(NSInteger, NSInteger, NSSize)>)fn {
  gSheetSizer = std::move(fn);
}

+ (std::function<NSSize(NSInteger, NSInteger, NSSize)>)popoverSizer {
  return gPopoverSizer;
}
+ (void)setPopoverSizer:(std::function<NSSize(NSInteger, NSInteger, NSSize)>)fn {
  gPopoverSizer = std::move(fn);
}

+ (std::function<NSView *(NSInteger)>)viewForTag {
  return gViewForTag;
}
+ (void)setViewForTag:(std::function<NSView *(NSInteger)>)fn {
  gViewForTag = std::move(fn);
}

+ (void)fitPopovers {
  for (NGNModalHostView *modal in gPopovers.allObjects) {
    [modal fitPopover];
    [modal fitSheet];
  }
}

// The sheet takes the size the core works out from what its content laid out to: a second commit
// on open for content that sizes itself.
- (void)fitSheet {
  if (_sheet == nil || !gSheetSizer) {
    return;
  }
  NSWindow *parent = _sheet.sheetParent;
  // Below the parent's title bar and toolbar, where a sheet hangs from.
  NSSize window = parent != nil ? parent.contentLayoutRect.size : _sheet.contentView.bounds.size;
  NSSize size = gSheetSizer(self.surfaceId, self.reactTag, window);
  NSSize chrome = [self chromeSize];
  size = NSMakeSize(std::min(size.width, window.width), std::min(size.height + chrome.height, window.height));
  NSSize current = _sheet.contentView.bounds.size;
  if (fabs(size.width - current.width) < 0.5 && fabs(size.height - current.height) < 0.5) {
    return;
  }
  [_sheet setContentSize:size];
}

// The popover takes its content's size, once it has one, as the core works it out from the
// shadow tree: the mounted views lose a root's padding once the popover is the root's size.
- (void)fitPopover {
  if (_popover == nil || !gPopoverSizer) {
    return;
  }
  NSSize window = _anchorWindowSize;
  NSSize size = gPopoverSizer(self.surfaceId, self.reactTag, window);
  NSSize chrome = [self chromeSize];
  size.height += chrome.height;
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
    self.frame = [self contentFrameIn:_cover.bounds];
  }
}

- (void)updateState:(const State::Shared &)state {
  [super updateState:state];
  _modalState = state;
  _reportedSize = NSZeroSize;
  [self coverResized];
}

- (void)didPresent {
}

- (void)presentOver:(NSView *)parent {
  NSView *anchor = self.desktopProps.anchor && gViewForTag ? gViewForTag(*self.desktopProps.anchor) : nil;
  if (anchor.window != nil) {
    [self presentPopoverAt:anchor];
    return;
  }
  if (self.desktopProps.presentation == ngn::ModalPresentation::Sheet && parent.window != nil) {
    [self presentSheetOn:parent.window];
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
  _cover.rootView = self;
  _cover.wantsLayer = YES;
  // Below the title bar and the toolbar, which stay the window's.
  NSRect below = [content convertRect:parent.window.contentLayoutRect fromView:nil];
  if (NSWidth(below) > 0 && NSHeight(below) > 0) {
    _cover.frame = below;
  }
  _cover.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, YES);
  }
  [content addSubview:_cover];
  self.frame = [self contentFrameIn:_cover.bounds];
  [_cover addSubview:self];
  [_cover.window makeFirstResponder:_cover];
  [self coverResized];
  [self didPresent];
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onShow({});
  }
}

- (void)presentSheetOn:(NSWindow *)window {
  if (_cover != nil || gInput == nullptr) {
    return;
  }
  // On the sheet in front, if there is one: sheets stack.
  while (window.attachedSheet != nil) {
    window = window.attachedSheet;
  }
  NSSize available = window.contentLayoutRect.size;
  // Measured first at the default width and the window's height, then fitted (fitSheet).
  NSSize first = NSMakeSize(std::min<CGFloat>(ngn::kDefaultSheetWidth, available.width), available.height);
  if (gSheetSizer) {
    first.width = gSheetSizer(self.surfaceId, self.reactTag, available).width;
  }
  NSRect frame = NSMakeRect(0, 0, first.width, first.height);
  _cover = [[NGNModalCover alloc] initWithFrame:frame
                                      surfaceId:static_cast<SurfaceId>(self.surfaceId)
                                      container:static_cast<ngn::ContainerId>(self.reactTag)
                                        rootTag:static_cast<Tag>(self.reactTag)
                                          input:gInput];
  _cover.modal = self;
  _cover.rootView = self;
  _cover.wantsLayer = YES;
  _cover.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, YES);
  }
  _sheet = [[NSWindow alloc] initWithContentRect:frame
                                       styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskFullSizeContentView
                                         backing:NSBackingStoreBuffered
                                           defer:NO];
  _sheet.releasedWhenClosed = NO;
  ngn::appkit::shieldNewWindow(_sheet);
  _sheet.delegate = [NGNUndoWindowDelegate shared];
  _sheet.contentView = _cover;
  self.frame = [self contentFrameIn:_cover.bounds];
  [_cover addSubview:self];
  [gPopovers addObject:self];
  [self coverResized];
  [window beginSheet:_sheet completionHandler:nil];
  [_sheet makeFirstResponder:_cover];
  [self didPresent];
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onShow({});
  }
}

- (void)presentPopoverAt:(NSView *)anchor {
  if (_cover != nil || gInput == nullptr) {
    return;
  }
  NSSize window = anchor.window.contentView.bounds.size;
  _anchorWindowSize = window;
  NSRect frame = NSMakeRect(0, 0, std::min(window.width, kPopoverMax), std::min(window.height, kPopoverMax));
  _cover = [[NGNModalCover alloc] initWithFrame:frame
                                      surfaceId:static_cast<SurfaceId>(self.surfaceId)
                                      container:static_cast<ngn::ContainerId>(self.reactTag)
                                        rootTag:static_cast<Tag>(self.reactTag)
                                          input:gInput];
  _cover.modal = self;
  _cover.rootView = self;
  _cover.wantsLayer = YES;
  if (gPresentationChanged) {
    gPresentationChanged(self.reactTag, YES);
  }
  self.frame = [self contentFrameIn:_cover.bounds];
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
  [self didPresent];
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
  if (_sheet != nil) {
    [gPopovers removeObject:self];
    NSWindow *parent = _sheet.sheetParent;
    if (parent != nil) {
      [parent endSheet:_sheet];
    }
    [_sheet orderOut:nil];
    _sheet.contentView = nil;
    _sheet = nil;
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
  if (_cover == nil) {
    return;
  }
  NSRect content = [self contentFrameIn:_cover.bounds];
  if (NSEqualSizes(content.size, _reportedSize)) {
    return;
  }
  _reportedSize = content.size;
  self.frame = content;
  [self applyPresentedSize:content.size];
}

- (void)applyPresentedSize:(NSSize)size {
  if (auto concrete = std::dynamic_pointer_cast<const ConcreteState<ModalHostViewState>>(_modalState)) {
    concrete->updateState(ModalHostViewState({static_cast<Float>(size.width), static_cast<Float>(size.height)}));
  }
}

- (NSRect)contentFrameIn:(NSRect)bounds {
  return bounds;
}

- (NSSize)chromeSize {
  return NSZeroSize;
}

- (NSView *)presentationView {
  return _cover;
}

- (ngn::ModalPresentation)presentedAs {
  if (_popover != nil) {
    return ngn::ModalPresentation::Popover;
  }
  return _sheet != nil ? ngn::ModalPresentation::Sheet : ngn::ModalPresentation::Cover;
}

- (void)requestClose {
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(self.eventEmitter)) {
    emitter->onRequestClose({});
  }
}

@end
