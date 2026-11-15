#include "screen-capture.h"

#import <AppKit/AppKit.h>

#include <atomic>

namespace ngn::appkit {

namespace {

std::atomic<bool> gProtected{false};

void apply(NSWindow *window) {
  NSWindowSharingType wanted = gProtected ? NSWindowSharingNone : NSWindowSharingReadOnly;
  if (window.sharingType != wanted) {
    window.sharingType = wanted;
  }
}

void applyToAll() {
  for (NSWindow *window in NSApp.windows) {
    apply(window);
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
                                                      apply(note.object);
                                                    }
                                                  }];
    }
  }

  void setProtected(bool on) override {
    gProtected = on;
    if (NSThread.isMainThread) {
      applyToAll();
    } else {
      dispatch_async(dispatch_get_main_queue(), ^{
        applyToAll();
      });
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
    apply(window);
  }
}

} // namespace ngn::appkit
