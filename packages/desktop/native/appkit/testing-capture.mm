#include "testing-capture.h"

#include "printing.h"

#import <AppKit/AppKit.h>

#include <string>
#include <utility>

namespace ngn::appkit {

namespace {

// `rect`, in the content view's points from its top left, drawn as a PNG at the screen's scale.
void drawn(NSWindow *window, NSRect rect, const WindowCapture::Done &done) {
  NSView *content = window.contentView;
  NSRect bounds = content.bounds;
  if (!content.isFlipped) {
    rect.origin.y = NSHeight(bounds) - NSMaxY(rect);
  }
  rect = NSIntersectionRect(rect, bounds);
  if (NSIsEmptyRect(rect)) {
    done("", "The region is outside the window");
    return;
  }
  // After pending layout and drawing, so the last commit is in the picture.
  [window displayIfNeeded];
  // Web views' pages in their places, as printing draws them.
  drawnContent(content, rect, [done](NSBitmapImageRep *rep) {
    if (rep == nil) {
      done("", "The window could not be drawn");
      return;
    }
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (png == nil) {
      done("", "The capture could not be encoded as a PNG");
      return;
    }
    done(std::string(static_cast<const char *>(png.bytes), png.length), "");
  });
}

class Capture final : public WindowCapture {
 public:
  Capture(std::function<NSWindow *()> window, std::function<NSView *(int64_t)> viewForTag)
      : window_(std::move(window)), viewForTag_(std::move(viewForTag)) {}

  void capture(std::optional<Region> region, Done done) override {
    auto window = window_;
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *w = window();
      if (w == nil || w.contentView == nil) {
        done("", "The app has no window to capture");
        return;
      }
      NSRect rect = region ? NSMakeRect(region->x, region->y, region->width, region->height) : w.contentView.bounds;
      drawn(w, rect, done);
    });
  }

  void captureView(int64_t tag, Done done) override {
    auto viewForTag = viewForTag_;
    dispatch_async(dispatch_get_main_queue(), ^{
      NSView *view = viewForTag(tag);
      NSView *content = view.window.contentView;
      if (view == nil || content == nil) {
        done("", "No view with tag " + std::to_string(tag) + " is in a window");
        return;
      }
      NSRect rect = [view convertRect:view.bounds toView:content];
      // In the content view's points from its top left, as a region is given.
      if (!content.isFlipped) {
        rect.origin.y = NSHeight(content.bounds) - NSMaxY(rect);
      }
      drawn(view.window, rect, done);
    });
  }

 private:
  std::function<NSWindow *()> window_;
  std::function<NSView *(int64_t)> viewForTag_;
};

} // namespace

NSWindow *capturedWindow(NSWindow *appWindow) {
  if (appWindow.isVisible) {
    return appWindow;
  }
  if (NSApp.keyWindow != nil) {
    return NSApp.keyWindow;
  }
  if (NSApp.mainWindow != nil) {
    return NSApp.mainWindow;
  }
  for (NSWindow *window in NSApp.orderedWindows) {
    if (window.isVisible && ![window isKindOfClass:NSPanel.class]) {
      return window;
    }
  }
  return appWindow;
}

std::shared_ptr<WindowCapture> makeWindowCapture(
    std::function<NSWindow *()> window, std::function<NSView *(int64_t tag)> viewForTag) {
  return std::make_shared<Capture>(std::move(window), std::move(viewForTag));
}

} // namespace ngn::appkit
