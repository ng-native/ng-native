#import "app-windows.h"
#import "test-launch.h"
#import "undo.h"
#import "screen-capture.h"

#import "surface-view.h"

using ngn::appkit::AppKitWindows;

@interface NGNWindowDelegate : NSObject <NSWindowDelegate>
- (instancetype)initWithSurface:(facebook::react::SurfaceId)surface windows:(AppKitWindows *)windows;
@end

@implementation NGNWindowDelegate {
  facebook::react::SurfaceId _surface;
  AppKitWindows *_windows;
}

- (NSUndoManager *)windowWillReturnUndoManager:(NSWindow *)window {
  return ngn::appkit::undoManagerFor(window);
}

- (instancetype)initWithSurface:(facebook::react::SurfaceId)surface windows:(AppKitWindows *)windows {
  if ((self = [super init])) {
    _surface = surface;
    _windows = windows;
  }
  return self;
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
  return _windows->shouldClose(_surface);
}

- (void)windowWillClose:(NSNotification *)note {
  _windows->willClose(_surface);
}

- (void)windowDidResize:(NSNotification *)note {
  _windows->frameChanged(_surface, true);
}

- (void)windowDidChangeBackingProperties:(NSNotification *)note {
  _windows->frameChanged(_surface, true);
}

- (void)windowDidMove:(NSNotification *)note {
  _windows->frameChanged(_surface, false);
}

- (void)windowDidBecomeKey:(NSNotification *)note {
  _windows->keyChanged(_surface, true);
}

- (void)windowDidResignKey:(NSNotification *)note {
  _windows->keyChanged(_surface, false);
}

@end

namespace ngn::appkit {

namespace {

void onMain(std::function<void()> task) {
  if (NSThread.isMainThread) {
    task();
    return;
  }
  auto shared = std::make_shared<std::function<void()>>(std::move(task));
  dispatch_async(dispatch_get_main_queue(), ^{
    (*shared)();
  });
}

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

WindowFrame frameOf(NSWindow *window) {
  NSRect content = [window contentRectForFrameRect:window.frame];
  return {.x = NSMinX(content), .y = NSMinY(content), .width = NSWidth(content), .height = NSHeight(content)};
}

// Whether enough of `rect` is on a screen to grab its title bar: a display that has gone away
// leaves a saved frame nowhere.
bool onScreen(NSRect rect) {
  for (NSScreen *screen in NSScreen.screens) {
    NSRect visible = NSIntersectionRect(screen.visibleFrame, rect);
    if (NSWidth(visible) >= 40 && NSHeight(visible) >= 20) {
      return true;
    }
  }
  return false;
}

} // namespace

AppKitWindows::AppKitWindows(Hooks hooks)
    : hooks_(std::move(hooks)),
      windows_([NSMutableDictionary dictionary]),
      delegates_([NSMutableDictionary dictionary]),
      unshown_([NSMutableDictionary dictionary]) {}

void AppKitWindows::setHost(std::shared_ptr<WindowHost> host) {
  host_ = std::move(host);
}

NSWindow *AppKitWindows::window(SurfaceId surface) const {
  return windows_[@(surface)];
}

SurfaceId AppKitWindows::surfaceOf(NSWindow *window) const {
  for (NSNumber *key in windows_) {
    if (windows_[key] == window) {
      return key.intValue;
    }
  }
  return 0;
}

void AppKitWindows::openWindow(
    SurfaceId surface,
    const WindowRequest &request,
    const WindowPlacement &placement,
    std::function<void()> opened) {
  onMain([this, surface, request, placement, opened] {
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
        NSWindowStyleMaskFullSizeContentView;
    if (request.resizable) {
      style |= NSWindowStyleMaskResizable;
    }
    NSRect content = NSMakeRect(placement.frame.x, placement.frame.y, placement.frame.width, placement.frame.height);
    NSWindow *window = [[NSWindow alloc] initWithContentRect:content
                                                   styleMask:style
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    shieldNewWindow(window);
    window.title = string(request.title);
    window.tabbingMode = NSWindowTabbingModeDisallowed;
    if (request.titleBar != TitleBar::Default) {
      window.titlebarAppearsTransparent = YES;
    }
    if (request.titleBar == TitleBar::Hidden) {
      window.titleVisibility = NSWindowTitleHidden;
    }
    if (request.minWidth || request.minHeight) {
      window.contentMinSize = NSMakeSize(request.minWidth.value_or(0), request.minHeight.value_or(0));
    }
    if (request.maxWidth || request.maxHeight) {
      window.contentMaxSize = NSMakeSize(request.maxWidth.value_or(CGFLOAT_MAX), request.maxHeight.value_or(CGFLOAT_MAX));
    }
    if (!placement.restored || !onScreen(window.frame)) {
      // Down and to the right of the window in front, or near the top left of the screen.
      NSWindow *front = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.orderedWindows.firstObject;
      NSPoint at;
      if (front != nil && front.visible) {
        at = NSMakePoint(NSMinX(front.frame) + 28, NSMaxY(front.frame) - 28);
      } else {
        NSRect visible = NSScreen.mainScreen.visibleFrame;
        at = NSMakePoint(NSMinX(visible) + 40, NSMaxY(visible) - 40);
      }
      // Past any window already there, so a second note never hides the first.
      for (bool taken = true; taken;) {
        taken = false;
        for (NSWindow *other in NSApp.windows) {
          if (other.visible && fabs(NSMinX(other.frame) - at.x) < 2 && fabs(NSMaxY(other.frame) - at.y) < 2) {
            at = NSMakePoint(at.x + 28, at.y - 28);
            taken = true;
          }
        }
      }
      [window setFrameTopLeftPoint:at];
    }
    NGNWindowDelegate *delegate = [[NGNWindowDelegate alloc] initWithSurface:surface windows:this];
    delegates_[@(surface)] = delegate;
    window.delegate = delegate;
    NSRect bounds = NSMakeRect(0, 0, NSWidth(content), NSHeight(content));
    // A split view controller a reloaded app's window had gives way to the new surface.
    window.contentViewController = nil;
    window.contentView = hooks_.makeSurface(surface, bounds);
    windows_[@(surface)] = window;
    unshown_[@(surface)] = @(request.fullScreen);
    hooks_.startSurface(surface, window);
    opened();
  });
}

void AppKitWindows::didMount(SurfaceId surface) {
  if (unshown_[@(surface)] == nil || windows_[@(surface)] == nil || held_.count(surface) > 0) {
    return;
  }
  if (!hooks_.whenShown) {
    show(surface);
    return;
  }
  held_.insert(surface);
  hooks_.whenShown([this, surface] {
    held_.erase(surface);
    show(surface);
  });
}

void AppKitWindows::show(SurfaceId surface) {
  NSNumber *fullScreen = unshown_[@(surface)];
  NSWindow *window = windows_[@(surface)];
  // A window closed while the splash held it is not shown.
  if (fullScreen == nil || window == nil) {
    return;
  }
  [unshown_ removeObjectForKey:@(surface)];
  showWindow(window);
  // The app learns the size the window opened at, which a restored frame decides.
  if (host_) {
    host_->resized(surface, frameOf(window), window.backingScaleFactor);
  }
  if (fullScreen.boolValue) {
    [window toggleFullScreen:nil];
  }
}

void AppKitWindows::closeWindow(SurfaceId surface) {
  onMain([this, surface] {
    // close does not ask windowShouldClose: the app already decided.
    [windows_[@(surface)] close];
  });
}

void AppKitWindows::focusWindow(SurfaceId surface) {
  onMain([this, surface] {
    NSWindow *window = windows_[@(surface)];
    if (window != nil && unshown_[@(surface)] == nil) {
      if (window.miniaturized) {
        [window deminiaturize:nil];
      }
      activateWith(window);
    }
  });
}

void AppKitWindows::setWindowTitle(SurfaceId surface, const std::string &title) {
  onMain([this, surface, title] { windows_[@(surface)].title = string(title); });
}

void AppKitWindows::beginQuit() {
  onMain([] { [NSApp terminate:nil]; });
}

void AppKitWindows::replyToQuit(bool proceed) {
  onMain([proceed] { [NSApp replyToApplicationShouldTerminate:proceed]; });
}

void AppKitWindows::after(double seconds, std::function<void()> task) {
  auto shared = std::make_shared<std::function<void()>>(std::move(task));
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    (*shared)();
  });
}

bool AppKitWindows::shouldClose(SurfaceId surface) {
  return host_ == nullptr || host_->closeRequested(surface);
}

void AppKitWindows::willClose(SurfaceId surface) {
  NSWindow *window = windows_[@(surface)];
  window.delegate = nil;
  [windows_ removeObjectForKey:@(surface)];
  [delegates_ removeObjectForKey:@(surface)];
  [unshown_ removeObjectForKey:@(surface)];
  hooks_.stopSurface(surface);
  if (host_) {
    if (host_->focusedSurface() == surface) {
      host_->focused(std::nullopt);
    }
  }
}

void AppKitWindows::frameChanged(SurfaceId surface, bool resized) {
  NSWindow *window = windows_[@(surface)];
  if (window == nil) {
    return;
  }
  if (resized) {
    hooks_.resizeSurface(surface, window);
    if (window.isKeyWindow && hooks_.keyWindowChanged) {
      hooks_.keyWindowChanged(window);
    }
  }
  // A window still waiting for its first frame has not been placed by the user.
  if (host_ && unshown_[@(surface)] == nil) {
    if (resized) {
      host_->resized(surface, frameOf(window), window.backingScaleFactor);
    } else {
      host_->moved(surface, frameOf(window));
    }
  }
}

void AppKitWindows::keyChanged(SurfaceId surface, bool key) {
  if (!host_) {
    return;
  }
  if (key) {
    host_->focused(surface);
    if (hooks_.keyWindowChanged) {
      hooks_.keyWindowChanged(windows_[@(surface)]);
    }
  } else if (host_->focusedSurface() == surface) {
    host_->focused(std::nullopt);
  }
}

} // namespace ngn::appkit
