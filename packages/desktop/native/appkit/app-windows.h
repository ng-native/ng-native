// The app's windows as NSWindows, one surface each (the core's WindowBackend), and the app
// delegate's part in closing and quitting, which the core decides (app-windows.h).
#pragma once

#include <set>

#import <AppKit/AppKit.h>

#include "ngn/app-windows.h"

#include <functional>
#include <memory>

@class NGNSurfaceView;

namespace ngn::appkit {

class AppKitWindows final : public WindowBackend {
 public:
  // What a window needs from the rest of the host. Main thread.
  struct Hooks {
    // A surface view for the window's content, registered with the mounting backend.
    std::function<NGNSurfaceView *(SurfaceId, NSRect)> makeSurface;
    // Start, size and stop the surface on the runtime, at the window's size.
    std::function<void(SurfaceId, NSWindow *)> startSurface;
    std::function<void(SurfaceId, NSWindow *)> resizeSurface;
    std::function<void(SurfaceId)> stopSurface;
    // The key window changed, or its size did.
    std::function<void(NSWindow *)> keyWindowChanged;
    // Runs a first show now, or once the splash screen lets the windows go, on the main thread.
    std::function<void(std::function<void()>)> whenShown;
  };

  explicit AppKitWindows(Hooks hooks);

  // Set once, before the app runs.
  void setHost(std::shared_ptr<WindowHost> host);
  WindowHost *host() const {
    return host_.get();
  }

  // A surface mounted: its window shows on the first. Main thread.
  void didMount(SurfaceId surface);
  NSWindow *window(SurfaceId surface) const;
  // The surface whose window this is, or 0.
  SurfaceId surfaceOf(NSWindow *window) const;

  void openWindow(
      SurfaceId surface,
      const WindowRequest &request,
      const WindowPlacement &placement,
      std::function<void()> opened) override;
  void closeWindow(SurfaceId surface) override;
  void focusWindow(SurfaceId surface) override;
  void setWindowTitle(SurfaceId surface, const std::string &title) override;
  void beginQuit() override;
  void replyToQuit(bool proceed) override;
  void after(double seconds, std::function<void()> task) override;

  // The window delegate's calls. Main thread.
  bool shouldClose(SurfaceId surface);
  void willClose(SurfaceId surface);
  void frameChanged(SurfaceId surface, bool resized);
  void keyChanged(SurfaceId surface, bool key);

 private:
  // Shows a mounted window that has not shown yet. Main thread.
  void show(SurfaceId surface);
  Hooks hooks_;
  // Mounted, and waiting for the splash screen to show them.
  std::set<SurfaceId> held_;
  std::shared_ptr<WindowHost> host_;
  NSMutableDictionary<NSNumber *, NSWindow *> *windows_;
  NSMutableDictionary<NSNumber *, id> *delegates_;
  // Windows waiting for their first frame, and whether each opens in full screen.
  NSMutableDictionary<NSNumber *, NSNumber *> *unshown_;
};

} // namespace ngn::appkit
