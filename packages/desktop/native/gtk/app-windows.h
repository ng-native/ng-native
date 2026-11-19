// The app's windows on GTK (app-windows.h's WindowBackend): an AdwApplicationWindow of the app's
// AdwApplication per window the app opens, each filled by its own surface in the chrome of its
// title-bar mode (screens.h), and shown once that surface's first frame mounts. Size autosave and
// focus reports come with the window lifecycle.
#pragma once

#include "ngn/app-windows.h"
#include "ngn/default-menu.h"

#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>

namespace ngn::gtk {

// Shows `window` without the focus GTK gives the first focusable widget of a window shown with
// none, which would be a header bar's search field: macOS gives a new window no field the focus,
// and a field's focus is the app's to give (autoFocus). A focus set before it shows stays.
void presentWithoutInitialFocus(GtkWindow *window);

// The app's AdwApplication, registered, which every window belongs to. Named by `appId` when that
// is a valid application id, and not unique: single instance comes with the window lifecycle.
GtkApplication *startApplication(const std::string &appId);

// Calls `laidOut` each time GTK has laid out the realized `window` and is about to draw it (its
// frame clock's paint phase), for what moves with its chrome.
void afterLayout(GtkWidget *window, std::function<void()> laidOut);

class GtkWindows final : public WindowBackend {
 public:
  struct Hooks {
    // A window's surface widget was made: the backend mounts into it and input reads it.
    std::function<void(SurfaceId surface, GtkWidget *widget)> addSurface;
    // Start, size and stop the surface's app, with its size in points and its scale.
    std::function<void(SurfaceId surface, int width, int height, int scale)> startSurface;
    std::function<void(SurfaceId surface, int width, int height, int scale)> resizeSurface;
    std::function<void(SurfaceId surface)> stopSurface;
    // GTK laid out the surface's window: its chrome may have moved.
    std::function<void(SurfaceId surface)> laidOut;
    // The app agreed to quit, or nothing was listening when it was asked to.
    std::function<void()> quit;
    // The user closed the last of these windows. The host decides: the app's own window may still
    // be open.
    std::function<void()> lastWindowClosed;
  };

  // Windows of `application`, with the app's menus where `menus` says.
  GtkWindows(Hooks hooks, GtkApplication *application, MenuPlacement menus);

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
  GtkApplication *application_;
  MenuPlacement menus_;
  std::weak_ptr<WindowHost> host_;
  std::map<SurfaceId, Window> windows_;
};

// Runs `task` on GLib's default main context, which is the UI thread.
void onMainContext(std::function<void()> task);
// Runs `task` on the UI thread after `seconds`.
void runAfter(double seconds, std::function<void()> task);

} // namespace ngn::gtk
