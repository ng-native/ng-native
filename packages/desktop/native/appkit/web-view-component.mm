#import "web-view-component.h"

#import "web-view.h"

#include "ngn/library-glue.h"

@implementation NGNWebView {
  NGNWebViewController *_controller;
}

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    __weak NGNWebView *weakSelf = self;
    _controller = [[NGNWebViewController alloc] initWithLocks:ngn::sharedNavigationLocks()
        send:[weakSelf](const std::string &name, folly::dynamic payload) {
          if (auto emitter = weakSelf.eventEmitter) {
            emitter->dispatchEvent(name, std::move(payload), facebook::react::RawEvent::Category::Discrete);
          }
        }
        openExternally:[](const std::string &url) {
          if (NSURL *target = [NSURL URLWithString:@(url.c_str())]) {
            [NSWorkspace.sharedWorkspace openURL:target];
          }
        }];
  }
  return self;
}

- (void)dealloc {
  [_controller invalidate];
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  auto &glue = ngn::libraryGlue();
  auto config = glue.webViewConfig && props ? glue.webViewConfig(*props) : std::nullopt;
  if (!config) {
    return;
  }
  [_controller apply:*config];
  if (_controller.webView.superview != self) {
    _controller.webView.frame = self.bounds;
    _controller.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_controller.webView positioned:NSWindowBelow relativeTo:nil];
  }
}

- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
  [_controller command:name args:args];
}

- (NSResponder *)keyboardResponder {
  return _controller.webView != nil ? _controller.webView : self;
}

@end
