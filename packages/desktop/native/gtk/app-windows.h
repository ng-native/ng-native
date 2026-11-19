// The app's windows on GTK (app-windows.h's WindowBackend): a GtkWindow per window the app opens,
// each filled by its own surface, shown once that surface's first frame mounts. Plain GtkWindows
// for now: the libadwaita window and its header bar come with the chrome, and size autosave,
// title-bar modes and focus reports with the window lifecycle.
#pragma once

#include "ngn/app-windows.h"

#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>

namespace ngn::gtk {

class GtkWindows final : public WindowBackend {
 public:
  struct Hooks {
    // A window's surface widget was made: the backend mounts into it and input reads it.
    std::function<void(SurfaceId surface, GtkWidget *widget)> addSurface;
    // Start, size and stop the surface's app, with its size in points and its scale.
    std::function<void(SurfaceId surface, int width, int height, int scale)> startSurface;
    std::function<void(SurfaceId surface, int width, int height, int scale)> resizeSurface;
    std::function<void(SurfaceId surface)> stopSurface;
    // The app agreed to quit, or nothing was listening when it was asked to.
    std::function<void()> quit;
    // The user closed the last of these windows. The host decides: the app's own window may still
    // be open.
    std::function<void()> lastWindowClosed;
  };

  explicit GtkWindows(Hooks hooks);

  // The host the close button asks first. Set once, before any window opens.
  void setHost(std::weak_ptr<WindowHost> host);
  // The surface's first frame mounted: its window shows. The UI thread.
  void didMount(SurfaceId surface);
  GtkWidget *window(SurfaceId surface) const;
  GtkWidget *surfaceWidget(SurfaceId surface) const;

  void openWindow(SurfaceId surface, const WindowRequest &request, const WindowPlacement &placement, std::function<void()> opened) override;
  void closeWindow(SurfaceId surface) override;
  void focusWindow(SurfaceId surface) override;
  void setWindowTitle(SurfaceId surface, const std::string &title) override;
  void beginQuit() override;
  void replyToQuit(bool proceed) override;
  void after(double seconds, std::function<void()> task) override;

 private:
  struct Window {
    GtkWidget *window{nullptr};
    GtkWidget *surface{nullptr};
    bool shown{false};
  };
  void open(SurfaceId surface, const WindowRequest &request, const WindowPlacement &placement, std::function<void()> opened);
  void close(SurfaceId surface);

  Hooks hooks_;
  std::weak_ptr<WindowHost> host_;
  std::map<SurfaceId, Window> windows_;
};

// Runs `task` on GLib's default main context, which is the UI thread.
void onMainContext(std::function<void()> task);
// Runs `task` on the UI thread after `seconds`.
void runAfter(double seconds, std::function<void()> task);

} // namespace ngn::gtk
