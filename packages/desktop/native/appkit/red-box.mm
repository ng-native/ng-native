#import "red-box.h"

#import <AppKit/AppKit.h>

#include <atomic>

namespace {

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

NSColor *red() {
  // RCTRedBox's background.
  return [NSColor colorWithSRGBRed:0.8 green:0 blue:0 alpha:1];
}

// The error as text, for Copy: its message, then each frame's method and place.
NSString *plainText(const ngn::JsError &error) {
  NSMutableString *text = [string(error.message) mutableCopy];
  [text appendString:@"\n\n"];
  for (const auto &frame : ngn::shownFrames(error)) {
    [text appendFormat:@"%@\n    %@\n", string(frame.methodName.empty() ? "(anonymous)" : frame.methodName),
                       string(ngn::frameLocation(frame))];
  }
  return text;
}

NSAttributedString *stackText(const ngn::JsError &error) {
  NSMutableAttributedString *out = [[NSMutableAttributedString alloc] init];
  NSFont *method = [NSFont monospacedSystemFontOfSize:13 weight:NSFontWeightSemibold];
  NSFont *place = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];
  NSDictionary *methodStyle = @{NSFontAttributeName : method, NSForegroundColorAttributeName : NSColor.whiteColor};
  NSDictionary *placeStyle = @{
    NSFontAttributeName : place,
    NSForegroundColorAttributeName : [NSColor colorWithWhite:1 alpha:0.7],
  };
  for (const auto &frame : ngn::shownFrames(error)) {
    NSString *name = string(frame.methodName.empty() ? "(anonymous)" : frame.methodName);
    [out appendAttributedString:[[NSAttributedString alloc] initWithString:[name stringByAppendingString:@"\n"]
                                                                attributes:methodStyle]];
    auto location = ngn::frameLocation(frame);
    if (!location.empty()) {
      [out appendAttributedString:[[NSAttributedString alloc]
                                      initWithString:[NSString stringWithFormat:@"    %@\n", string(location)]
                                          attributes:placeStyle]];
    }
    [out appendAttributedString:[[NSAttributedString alloc] initWithString:@"\n" attributes:placeStyle]];
  }
  if (!error.componentStack.empty()) {
    [out appendAttributedString:[[NSAttributedString alloc] initWithString:string(error.componentStack)
                                                                attributes:placeStyle]];
  }
  return out;
}

} // namespace

// The window: Escape dismisses it and Command-R reloads, as RCTRedBox's keys do.
@interface NGNRedBoxWindow : NSWindow
@property (nonatomic, copy) void (^onDismiss)(void);
@property (nonatomic, copy) void (^onReload)(void);
@end

@implementation NGNRedBoxWindow
- (BOOL)canBecomeKeyWindow {
  return YES;
}
- (void)cancelOperation:(id)sender {
  if (self.onDismiss) {
    self.onDismiss();
  }
}
- (BOOL)performKeyEquivalent:(NSEvent *)event {
  if ((event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask) == NSEventModifierFlagCommand &&
      [event.charactersIgnoringModifiers isEqualToString:@"r"]) {
    if (self.onReload) {
      self.onReload();
    }
    return YES;
  }
  return [super performKeyEquivalent:event];
}
@end

@interface NGNRedBoxController : NSObject <NSWindowDelegate>
- (instancetype)initWithActions:(ngn::appkit::RedBoxActions)actions;
- (void)show:(const ngn::RedBoxContent &)content;
- (void)hide;
@end

@implementation NGNRedBoxController {
  ngn::appkit::RedBoxActions _actions;
  NGNRedBoxWindow *_window;
  NSTextField *_message;
  NSTextView *_stack;
  NSTextField *_position;
  NSButton *_previous;
  NSButton *_next;
  NSString *_copyText;
}

- (instancetype)initWithActions:(ngn::appkit::RedBoxActions)actions {
  if ((self = [super init])) {
    _actions = std::move(actions);
  }
  return self;
}

- (NSButton *)button:(NSString *)title action:(SEL)action {
  NSButton *button = [NSButton buttonWithTitle:title target:self action:action];
  button.bezelStyle = NSBezelStylePush;
  button.translatesAutoresizingMaskIntoConstraints = NO;
  return button;
}

- (void)build {
  _window = [[NGNRedBoxWindow alloc] initWithContentRect:NSMakeRect(0, 0, 760, 560)
                                               styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                         NSWindowStyleMaskResizable
                                                 backing:NSBackingStoreBuffered
                                                   defer:YES];
  _window.releasedWhenClosed = NO;
  _window.delegate = self;
  _window.backgroundColor = red();
  _window.titlebarAppearsTransparent = YES;
  _window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  _window.minSize = NSMakeSize(420, 300);
  __weak NGNRedBoxController *weak = self;
  _window.onDismiss = ^{
    [weak dismiss:nil];
  };
  _window.onReload = ^{
    [weak reload:nil];
  };

  NSView *content = _window.contentView;
  _message = [NSTextField wrappingLabelWithString:@""];
  _message.font = [NSFont systemFontOfSize:17 weight:NSFontWeightBold];
  _message.textColor = NSColor.whiteColor;
  _message.selectable = YES;
  _message.translatesAutoresizingMaskIntoConstraints = NO;
  [_message setContentCompressionResistancePriority:NSLayoutPriorityRequired
                                     forOrientation:NSLayoutConstraintOrientationVertical];

  NSScrollView *scroll = [[NSScrollView alloc] init];
  scroll.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  _stack = [[NSTextView alloc] init];
  _stack.editable = NO;
  _stack.selectable = YES;
  _stack.drawsBackground = NO;
  _stack.textContainerInset = NSMakeSize(0, 8);
  _stack.autoresizingMask = NSViewWidthSizable;
  scroll.documentView = _stack;

  NSButton *dismiss = [self button:@"Dismiss (Esc)" action:@selector(dismiss:)];
  NSButton *reload = [self button:@"Reload (⌘R)" action:@selector(reload:)];
  reload.keyEquivalent = @"\r";
  NSButton *copy = [self button:@"Copy" action:@selector(copyError:)];
  _previous = [self button:@"◀" action:@selector(previous:)];
  _next = [self button:@"▶" action:@selector(next:)];
  _position = [NSTextField labelWithString:@""];
  _position.textColor = [NSColor colorWithWhite:1 alpha:0.8];
  _position.translatesAutoresizingMaskIntoConstraints = NO;

  NSStackView *buttons = [NSStackView stackViewWithViews:@[ _previous, _position, _next ]];
  NSStackView *actions = [NSStackView stackViewWithViews:@[ copy, dismiss, reload ]];
  buttons.translatesAutoresizingMaskIntoConstraints = NO;
  actions.translatesAutoresizingMaskIntoConstraints = NO;

  for (NSView *view in @[ _message, scroll, buttons, actions ]) {
    [content addSubview:view];
  }
  [NSLayoutConstraint activateConstraints:@[
    [_message.topAnchor constraintEqualToAnchor:content.topAnchor constant:40],
    [_message.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:20],
    [_message.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-20],
    [scroll.topAnchor constraintEqualToAnchor:_message.bottomAnchor constant:12],
    [scroll.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:20],
    [scroll.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-20],
    [scroll.bottomAnchor constraintEqualToAnchor:actions.topAnchor constant:-12],
    [actions.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-20],
    [actions.bottomAnchor constraintEqualToAnchor:content.bottomAnchor constant:-16],
    [buttons.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:20],
    [buttons.centerYAnchor constraintEqualToAnchor:actions.centerYAnchor],
  ]];
}

- (void)show:(const ngn::RedBoxContent &)content {
  if (_window == nil) {
    [self build];
  }
  const auto &error = content.error;
  _window.title = error.fatal ? @"JavaScript error" : @"JavaScript error (soft)";
  _message.stringValue = string(error.message);
  [_stack.textStorage setAttributedString:stackText(error)];
  _copyText = plainText(error);
  BOOL several = content.count > 1;
  _previous.hidden = _next.hidden = _position.hidden = !several;
  _position.stringValue = [NSString stringWithFormat:@"%zu of %zu", content.index + 1, content.count];
  _previous.enabled = content.index > 0;
  _next.enabled = content.index + 1 < content.count;
  if (!_window.visible) {
    // Over the window the app was using, as RCTRedBox covers its own.
    NSWindow *app = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.mainWindow;
    if (app != nil && app != _window) {
      NSRect frame = NSInsetRect(app.frame, 24, 24);
      [_window setFrame:frame display:NO];
    } else {
      [_window center];
    }
  }
  [NSApp activateIgnoringOtherApps:YES];
  [_window makeKeyAndOrderFront:nil];
}

- (void)hide {
  [_window orderOut:nil];
}

- (void)dismiss:(id)sender {
  if (_actions.dismiss) {
    _actions.dismiss();
  }
}

- (void)reload:(id)sender {
  if (_actions.reload) {
    _actions.reload();
  }
}

- (void)copyError:(id)sender {
  [NSPasteboard.generalPasteboard clearContents];
  [NSPasteboard.generalPasteboard setString:(_copyText != nil ? _copyText : @"") forType:NSPasteboardTypeString];
}

- (void)previous:(id)sender {
  if (_actions.step) {
    _actions.step(-1);
  }
}

- (void)next:(id)sender {
  if (_actions.step) {
    _actions.step(1);
  }
}

// The close button dismisses, as Escape does.
- (BOOL)windowShouldClose:(NSWindow *)sender {
  [self dismiss:nil];
  return NO;
}

@end

namespace ngn::appkit {

namespace {

class RedBoxWindow final : public RedBoxBackend {
 public:
  explicit RedBoxWindow(RedBoxActions actions) {
    controller_ = [[NGNRedBoxController alloc] initWithActions:std::move(actions)];
  }

  void show(const RedBoxContent &content) override {
    NGNRedBoxController *controller = controller_;
    auto copy = std::make_shared<RedBoxContent>(content);
    dispatch_async(dispatch_get_main_queue(), ^{
      [controller show:*copy];
    });
  }

  void hide() override {
    NGNRedBoxController *controller = controller_;
    dispatch_async(dispatch_get_main_queue(), ^{
      [controller hide];
    });
  }

 private:
  NGNRedBoxController *controller_;
};

} // namespace

std::shared_ptr<RedBoxBackend> makeRedBoxWindow(RedBoxActions actions) {
  return std::make_shared<RedBoxWindow>(std::move(actions));
}

// The overlay, and the call that resumes the JavaScript. Main thread.
NSPanel *gPausedPanel;
std::function<void()> gResume;
// Moved on by each show and hide, from any thread: a show queued before a later hide finds it moved
// on and does nothing.
std::atomic<uint64_t> gPausedTurn{0};

} // namespace ngn::appkit

@interface NGNDebuggerResumeTarget : NSObject
@end

@implementation NGNDebuggerResumeTarget
+ (void)resume:(id)sender {
  auto resume = std::move(ngn::appkit::gResume);
  ngn::appkit::hideDebuggerPaused();
  if (resume) {
    resume();
  }
}
@end

namespace ngn::appkit {

void showDebuggerPaused(std::function<void()> resume) {
  auto shared = std::make_shared<std::function<void()>>(std::move(resume));
  uint64_t turn = ++gPausedTurn;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (gPausedTurn != turn) {
      return;
    }
    gResume = *shared;
    NSWindow *app = NSApp.mainWindow != nil ? NSApp.mainWindow : NSApp.windows.firstObject;
    if (gPausedPanel == nil) {
      gPausedPanel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 260, 40)
                                                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                                                  backing:NSBackingStoreBuffered
                                                    defer:YES];
      gPausedPanel.releasedWhenClosed = NO;
      gPausedPanel.opaque = NO;
      gPausedPanel.backgroundColor = NSColor.clearColor;
      gPausedPanel.hasShadow = YES;
      NSVisualEffectView *pill = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, 260, 40)];
      pill.material = NSVisualEffectMaterialHUDWindow;
      pill.state = NSVisualEffectStateActive;
      pill.wantsLayer = YES;
      pill.layer.cornerRadius = 20;
      pill.layer.masksToBounds = YES;
      NSTextField *label = [NSTextField labelWithString:@"Paused in debugger"];
      label.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
      label.frame = NSMakeRect(18, 11, 160, 18);
      NSButton *resume = [NSButton buttonWithTitle:@"Resume"
                                            target:NGNDebuggerResumeTarget.class
                                            action:@selector(resume:)];
      resume.bezelStyle = NSBezelStylePush;
      resume.controlSize = NSControlSizeSmall;
      resume.frame = NSMakeRect(176, 7, 72, 26);
      [pill addSubview:label];
      [pill addSubview:resume];
      gPausedPanel.contentView = pill;
    }
    if (app != nil) {
      NSRect frame = app.frame;
      [gPausedPanel setFrameOrigin:NSMakePoint(NSMidX(frame) - 130, NSMaxY(frame) - 40 - 44)];
      if (gPausedPanel.parentWindow != app) {
        [gPausedPanel.parentWindow removeChildWindow:gPausedPanel];
        [app addChildWindow:gPausedPanel ordered:NSWindowAbove];
      }
    }
    [gPausedPanel orderFront:nil];
  });
}

void hideDebuggerPaused() {
  uint64_t turn = ++gPausedTurn;
  auto hide = ^{
    // A show since has the panel now.
    if (gPausedTurn != turn) {
      return;
    }
    gResume = nullptr;
    [gPausedPanel.parentWindow removeChildWindow:gPausedPanel];
    [gPausedPanel orderOut:nil];
  };
  if (NSThread.isMainThread) {
    hide();
  } else {
    dispatch_async(dispatch_get_main_queue(), hide);
  }
}

} // namespace ngn::appkit
