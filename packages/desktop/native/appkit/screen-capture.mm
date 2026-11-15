#include "screen-capture.h"

#import <AppKit/AppKit.h>

#include <atomic>

namespace ngn::appkit {

namespace {

std::atomic<bool> gProtected{false};

// `gProtected` is the state the latest request asked for; each request applies its own, in order
// on the main thread, so the last one asked is the one the windows keep.
void apply(NSWindow *window, bool on) {
  NSWindowSharingType wanted = on ? NSWindowSharingNone : NSWindowSharingReadOnly;
  if (window.sharingType != wanted) {
    window.sharingType = wanted;
  }
}

void applyToAll(bool on) {
  for (NSWindow *window in NSApp.windows) {
    apply(window, on);
  }
}

class WindowShield final : public CaptureShield {
 public:
  WindowShield() {
    // Every window AppKit updates or shows, the system's panels and alerts among them, so one the
    // host does not make itself is covered too.
    for (NSNotificationName name in @[ NSWindowDidUpdateNotification, NSWindowDidChangeOcclusionStateNotification ]) {
      [NSNotificationCenter.defaultCenter addObserverForName:name
                                                      object:nil
                                                       queue:nil
                                                  usingBlock:^(NSNotification *note) {
                                                    if (gProtected) {
                                                      apply(note.object, true);
                                                    }
                                                  }];
    }
  }

  void setProtected(bool on, std::function<void()> done) override {
    gProtected = on;
    auto finish = std::make_shared<std::function<void()>>(std::move(done));
    auto apply = ^{
      applyToAll(on);
      if (*finish) {
        (*finish)();
      }
    };
    // Off the main thread, applied there without blocking this thread on it.
    if (NSThread.isMainThread) {
      apply();
    } else {
      dispatch_async(dispatch_get_main_queue(), apply);
    }
  }
};

} // namespace

std::shared_ptr<CaptureShield> captureShield() {
  static auto shield = std::make_shared<WindowShield>();
  return shield;
}

void shieldNewWindow(NSWindow *window) {
  if (gProtected) {
    apply(window, true);
  }
}

} // namespace ngn::appkit
