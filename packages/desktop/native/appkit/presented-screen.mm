#import "presented-screen.h"

#import "header-toolbar.h"

#include "ngn/header-bar.h"
#include "ngn/screen-presentation.h"
#include "ngn/split-view.h"

#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {
NSHashTable<NGNPresentedScreenView *> *gPresented = [NSHashTable weakObjectsHashTable];

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

constexpr CGFloat kMargin = 20;
} // namespace

@implementation NGNPresentedScreenView {
  __weak NSView *_stack;
  BOOL _presented;
  ngn::SheetChrome _chrome;
  NSView *_chromeView;
}

+ (void)refreshChrome {
  for (NGNPresentedScreenView *screen in gPresented.allObjects) {
    [screen updateChrome];
  }
}

- (void)setPresented:(BOOL)presented {
  if (presented == _presented) {
    return;
  }
  _presented = presented;
  if (presented) {
    _stack = self.superview;
    [self removeFromSuperview];
    [gPresented addObject:self];
    [self presentOver:_stack];
  } else {
    [gPresented removeObject:self];
    [self dismiss];
    [_chromeView removeFromSuperview];
    _chromeView = nil;
    _chrome = {};
    [_stack addSubview:self];
  }
}

- (void)dismiss {
  [gPresented removeObject:self];
  [super dismiss];
}

- (NGNView *)headerConfig {
  for (NSView *v in self.subviews) {
    if ([v isKindOfClass:NGNHeaderConfigView.class]) {
      return (NGNView *)v;
    }
  }
  return nil;
}

- (ngn::SheetChrome)currentChrome {
  NGNView *config = [self headerConfig];
  auto bar = config && config.props ? ngn::headerBar(*config.props) : std::nullopt;
  return bar ? ngn::sheetChrome(*bar, self.presentedAs) : ngn::SheetChrome{};
}

- (NSRect)contentFrameIn:(NSRect)bounds {
  return NSMakeRect(
      NSMinX(bounds), NSMinY(bounds) + _chrome.top(), NSWidth(bounds),
      std::max<CGFloat>(0, NSHeight(bounds) - _chrome.top() - _chrome.bottom()));
}

- (NSSize)chromeSize {
  auto chrome = [self currentChrome];
  return NSMakeSize(0, chrome.top() + chrome.bottom());
}

- (void)applyPresentedSize:(NSSize)size {
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ngn::SplitPaneState>>(self.state);
  facebook::react::Size wanted{static_cast<Float>(size.width), static_cast<Float>(size.height)};
  if (concrete && concrete->getData().size != wanted) {
    concrete->updateState(ngn::SplitPaneState{.size = wanted});
  }
}

- (void)didPresent {
  [self updateChrome];
}

- (void)updateChrome {
  NSView *container = self.presentationView;
  if (container == nil) {
    return;
  }
  auto chrome = [self currentChrome];
  container.accessibilityLabel = chrome.label.empty() ? nil : nsString(chrome.label);
  if (chrome == _chrome && (_chromeView != nil || (chrome.heading.empty() && chrome.buttons.empty()))) {
    return;
  }
  _chrome = chrome;
  [_chromeView removeFromSuperview];
  _chromeView = nil;
  if (!chrome.heading.empty() || !chrome.buttons.empty()) {
    _chromeView = [self chromeIn:container];
  }
  // The content moves out of the way, and layout hears its new size.
  self.frame = [self contentFrameIn:container.bounds];
  [self applyPresentedSize:self.frame.size];
}

// The heading and the button row, in a view under the content that fills the container.
- (NSView *)chromeIn:(NSView *)container {
  NSView *chromeView = [[NSView alloc] initWithFrame:container.bounds];
  chromeView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (!_chrome.heading.empty()) {
    NSTextField *heading = [NSTextField labelWithString:nsString(_chrome.heading)];
    heading.font = [NSFont boldSystemFontOfSize:NSFont.systemFontSize];
    heading.translatesAutoresizingMaskIntoConstraints = NO;
    heading.accessibilityRole = NSAccessibilityStaticTextRole;
    [chromeView addSubview:heading];
    [NSLayoutConstraint activateConstraints:@[
      [heading.leadingAnchor constraintEqualToAnchor:chromeView.leadingAnchor constant:kMargin],
      [heading.trailingAnchor constraintLessThanOrEqualToAnchor:chromeView.trailingAnchor constant:-kMargin],
      [heading.centerYAnchor constraintEqualToAnchor:chromeView.topAnchor constant:ngn::kSheetHeadingHeight / 2],
    ]];
  }
  NSView *previous = nil;
  bool escapeTaken = false;
  // Laid out from the trailing edge: the last button is the rightmost.
  for (auto it = _chrome.buttons.rbegin(); it != _chrome.buttons.rend(); ++it) {
    NSButton *button = [NSButton buttonWithTitle:nsString(it->title) target:self action:@selector(press:)];
    button.identifier = nsString(it->id);
    button.enabled = !it->disabled;
    button.translatesAutoresizingMaskIntoConstraints = NO;
    if (it->isDefault) {
      button.keyEquivalent = @"\r";
    }
    [chromeView addSubview:button];
    [NSLayoutConstraint activateConstraints:@[
      [button.centerYAnchor constraintEqualToAnchor:chromeView.bottomAnchor constant:-ngn::kSheetButtonRowHeight / 2],
      previous == nil ? [button.trailingAnchor constraintEqualToAnchor:chromeView.trailingAnchor constant:-kMargin]
                      : [button.trailingAnchor constraintEqualToAnchor:previous.leadingAnchor constant:-12],
    ]];
    previous = button;
  }
  // Escape presses the first left one (Cancel).
  for (NSView *v in chromeView.subviews) {
    if (![v isKindOfClass:NSButton.class]) {
      continue;
    }
    for (const auto &b : _chrome.buttons) {
      if (b.cancel && !escapeTaken && [((NSButton *)v).identifier isEqualToString:nsString(b.id)]) {
        ((NSButton *)v).keyEquivalent = @"\033";
        escapeTaken = true;
      }
    }
  }
  [container addSubview:chromeView positioned:NSWindowBelow relativeTo:nil];
  return chromeView;
}

- (void)press:(NSButton *)sender {
  if (auto emitter = [self headerConfig].eventEmitter) {
    emitter->dispatchEvent(
        "pressHeaderBarButtonItem", folly::dynamic::object("buttonId", sender.identifier.UTF8String),
        RawEvent::Category::Discrete);
  }
}

// Escape, Cmd-W or a click outside a popover: native dismissal, which the router follows.
- (void)requestClose {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent("dismissed", folly::dynamic::object("dismissCount", 1), RawEvent::Category::Discrete);
  }
}

@end
