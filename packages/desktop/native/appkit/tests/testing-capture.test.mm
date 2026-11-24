// The AppKit WindowCapture (testing-capture.mm) on a window made offscreen and never shown.
#include "../testing-capture.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

#include <optional>
#include <string>

// A flipped content view, as the host's surface is: red, with a blue square 10 points in.
@interface NGNCaptureTestView : NSView
@end
@implementation NGNCaptureTestView
- (BOOL)isFlipped {
  return YES;
}
- (void)drawRect:(NSRect)dirty {
  [NSColor.redColor setFill];
  NSRectFill(self.bounds);
  [NSColor.blueColor setFill];
  NSRectFill(NSMakeRect(10, 10, 20, 20));
}
@end

// A web view whose snapshot always fails, as one can.
@interface NGNFailingSnapshotWebView : WKWebView
@end
@implementation NGNFailingSnapshotWebView
- (void)takeSnapshotWithConfiguration:(WKSnapshotConfiguration *)configuration
                    completionHandler:(void (^)(NSImage *, NSError *))completionHandler {
  dispatch_async(dispatch_get_main_queue(), ^{
    completionHandler(nil, [NSError errorWithDomain:@"test" code:1 userInfo:nil]);
  });
}
@end

namespace {

struct Taken {
  std::string png;
  std::string error;
  bool done{false};
};

Taken wait(Taken &taken) {
  for (int i = 0; i < 100 && !taken.done; ++i) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  REQUIRE(taken.done);
  return taken;
}

NSBitmapImageRep *decoded(const std::string &png) {
  NSData *data = [NSData dataWithBytes:png.data() length:png.size()];
  return [NSBitmapImageRep imageRepWithData:data];
}

// The colour at a point, in the bitmap's points.
NSColor *at(NSBitmapImageRep *rep, NSSize points, double x, double y) {
  double scale = rep.pixelsWide / points.width;
  return [[rep colorAtX:static_cast<NSInteger>(x * scale) y:static_cast<NSInteger>(y * scale)]
      colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
}

} // namespace

TEST_CASE("WindowCapture draws the app's window, a region of it, and a view, in process") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 100, 80)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNCaptureTestView *content = [[NGNCaptureTestView alloc] initWithFrame:NSMakeRect(0, 0, 100, 80)];
  window.contentView = content;
  NSView *square = [[NSView alloc] initWithFrame:NSMakeRect(10, 10, 20, 20)];
  [content addSubview:square];

  NSWindow *current = window;
  auto capture = ngn::appkit::makeWindowCapture([&] { return current; },
                                                [&](int64_t tag) -> NSView * { return tag == 7 ? square : nil; });
  auto take = [](Taken &taken) {
    return [&taken](std::string png, std::string error) {
      taken = {std::move(png), std::move(error), true};
    };
  };

  Taken whole;
  capture->capture(std::nullopt, take(whole));
  auto all = wait(whole);
  REQUIRE(all.error.empty());
  NSBitmapImageRep *rep = decoded(all.png);
  REQUIRE((rep != nil));
  CHECK(rep.pixelsWide >= 100);
  // From the top left, as a region is given: blue 10 points in, red beside it.
  CHECK([at(rep, NSMakeSize(100, 80), 15, 15) blueComponent] > 0.9);
  CHECK([at(rep, NSMakeSize(100, 80), 50, 50) redComponent] > 0.9);

  Taken part;
  capture->capture(ngn::WindowCapture::Region{10, 10, 20, 20}, take(part));
  NSBitmapImageRep *region = decoded(wait(part).png);
  REQUIRE((region != nil));
  CHECK([at(region, NSMakeSize(20, 20), 10, 10) blueComponent] > 0.9);

  Taken view;
  capture->captureView(7, take(view));
  NSBitmapImageRep *viewRep = decoded(wait(view).png);
  REQUIRE((viewRep != nil));
  CHECK(viewRep.pixelsWide == region.pixelsWide);
  CHECK([at(viewRep, NSMakeSize(20, 20), 10, 10) blueComponent] > 0.9);

  Taken missing;
  capture->captureView(8, take(missing));
  CHECK(wait(missing).error == "No view with tag 8 is in a window");
  Taken outside;
  capture->capture(ngn::WindowCapture::Region{200, 200, 10, 10}, take(outside));
  CHECK(wait(outside).error == "The region is outside the window");
  current = nil;
  Taken none;
  capture->capture(std::nullopt, take(none));
  CHECK(wait(none).error == "The app has no window to capture");
  [window close];
}

TEST_CASE("The window captured is the default surface's while shown, else one the app shows") {
  [NSApplication sharedApplication];
  auto make = [] {
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 50, 50)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    return window;
  };
  NSWindow *app = make();
  NSWindow *main = make();
  [main orderFront:nil];
  // No default-surface window, or one not shown: a window the app shows, as provideMainWindow's.
  CHECK((ngn::appkit::capturedWindow(nil) == main));
  CHECK((ngn::appkit::capturedWindow(app) == main));
  [app orderFront:nil];
  CHECK((ngn::appkit::capturedWindow(app) == app));
  [app close];
  [main close];
  CHECK((ngn::appkit::capturedWindow(nil) == nil));
}

TEST_CASE("WindowCapture shows a web view's page, which WebKit draws out of process, where it is") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 100, 80)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNCaptureTestView *content = [[NGNCaptureTestView alloc] initWithFrame:NSMakeRect(0, 0, 100, 80)];
  window.contentView = content;
  // A blue page in the bottom right of the red window.
  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(50, 40, 50, 40) configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  [web loadHTMLString:@"<html><body style='margin:0;background:rgb(0,0,255)'></body></html>" baseURL:nil];
  for (int i = 0; i < 1000 && (web.isLoading || web.estimatedProgress < 1); ++i) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  REQUIRE(!web.isLoading);
  auto capture = ngn::appkit::makeWindowCapture([&] { return window; }, [](int64_t) -> NSView * { return nil; });
  Taken whole;
  capture->capture(std::nullopt, [&whole](std::string png, std::string error) {
    whole = {std::move(png), std::move(error), true};
  });
  for (int i = 0; i < 500 && !whole.done; ++i) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  REQUIRE(whole.done);
  NSBitmapImageRep *rep = decoded(whole.png);
  REQUIRE((rep != nil));
  NSColor *page = at(rep, NSMakeSize(100, 80), 75, 60);
  CHECK(page.blueComponent > 0.9);
  CHECK(page.redComponent < 0.2);
  CHECK([at(rep, NSMakeSize(100, 80), 75, 20) redComponent] > 0.9);
  [window close];
}

TEST_CASE("WindowCapture fails where a web view's page could not be drawn, rather than leave it blank") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 100, 80)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNCaptureTestView *content = [[NGNCaptureTestView alloc] initWithFrame:NSMakeRect(0, 0, 100, 80)];
  window.contentView = content;
  NGNFailingSnapshotWebView *web =
      [[NGNFailingSnapshotWebView alloc] initWithFrame:NSMakeRect(50, 40, 50, 40) configuration:[WKWebViewConfiguration new]];
  [content addSubview:web];
  auto capture = ngn::appkit::makeWindowCapture([&] { return window; }, [](int64_t) -> NSView * { return nil; });
  Taken taken;
  capture->capture(std::nullopt, [&taken](std::string png, std::string error) {
    taken = {std::move(png), std::move(error), true};
  });
  CHECK(wait(taken).error == "A web view's page could not be drawn");
  CHECK(taken.png.empty());
  [window close];
}
