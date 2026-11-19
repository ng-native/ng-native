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
#include <string>
#include <vector>

namespace ngn::gtk {

// Shows `window` without the focus GTK gives the first focusable widget of a window shown with
// none, which would be a header bar's search field: macOS gives a new window no field the focus,
// and a field's focus is the app's to give (autoFocus). A focus set before it shows stays.
void presentWithoutInitialFocus(GtkWindow *window);

// The app's AdwApplication, registered, which every window belongs to, named by `appId` when that
// is a valid application id. It handles open (links and files). A `unique` one is the app's single
// instance: a second launch finds the first registered (g_application_get_is_remote) and hands it
// its links (forwardLaunch). `service` starts it as the app's D-Bus service, as the session bus
// does for a DBusActivatable desktop entry.
GtkApplication *startApplication(const std::string &appId, bool unique = false, bool service = false);

// A second launch's work, in the instance already running: its links and files (as a launcher's
// %U gives them) to open, or nothing to raise the app's window. Sent over the session bus.
void forwardLaunch(GtkApplication *application, const std::vector<std::string> &openArgs);

// A launch's links and files as the URLs the app's DeepLinks hears: a path becomes a file:// URL.
std::vector<std::string> openUrls(const std::vector<std::string> &openArgs);

// Calls `laidOut` each time GTK has laid out the realized `window` and is about to draw it (its
// frame clock's paint phase), for what moves with its chrome. Returns the handler's id on that
// clock, for whoever must stop it before `laidOut`'s captures go; 0 when the window has no clock.
gulong afterLayout(GtkWidget *window, std::function<void()> laidOut);

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
    // The user closed the last of these windows, and no app listens to decide (the core's
    // WindowHost::lastWindowClosed). The host decides: the app's own window may still be open.
    std::function<void()> lastWindowClosed;
  };

  // Windows of `application`, with the app's menus where `menus` says.
  GtkWindows(Hooks hooks, GtkApplication *application, MenuPlacement menus);
  // Disconnects the handlers of, then destroys, the windows still open.
  ~GtkWindows() override;
  GtkWindows(const GtkWindows &) = delete;
  GtkWindows &operator=(const GtkWindows &) = delete;

  // Whether a window fills the screen, so it has the size GTK gives it rather than its own. A seam for
  // tests, which run without a window manager to maximise one.
  std::function<bool(GtkWindow *)> windowFills = &GtkWindows::fillsScreen;

  // The host the close button asks first. Set once, before any window opens.
  void setHost(std::weak_ptr<WindowHost> host);
  // The surface's first frame mounted: its window shows. The UI thread.
  void didMount(SurfaceId surface);
  // The app was launched again (GApplication's activate or open): the window last active comes
  // to the front, or the app hears `reopen` when it has none shown. The UI thread.
  void raise();
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
    // The handlers that call back into these windows, stopped when the window closes or these go.
    gulong scaled{0};
    gulong closeRequested{0};
    // The window's notify handlers (size, maximised, full screen, focus).
    std::vector<gulong> notified;
    GdkFrameClock *clock{nullptr};
    gulong laidOut{0};
    // The size the app last heard, so an allocation that changes nothing says nothing.
    double reportedWidth{0};
    double reportedHeight{0};
  };
  static void disconnect(Window &entry);
  static bool fillsScreen(GtkWindow *window);
  void open(SurfaceId surface, const WindowRequest &request, const WindowPlacement &placement, std::function<void()> opened);
  void close(SurfaceId surface);
  // The window's size, maximised and full-screen state changed: the app hears its size now, and
  // its frame autosaves with the size it goes back to (never a place: GTK has none to give).
  // `onAllocation`: GTK has just allocated the surface, which only a window filling the screen reports.
  void reportFrame(SurfaceId surface, bool onAllocation = false);
  void reportFocus(SurfaceId surface, bool active);

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
