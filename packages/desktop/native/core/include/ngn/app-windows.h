// Several windows on one runtime: the `NgNativeWindows` module and the rules every desktop backend
// shares. Each window has a surface of its own, which the app renders into; the app's own surface
// (1) is never shown.
//
// The host never closes a window or quits on its own. The close button, Cmd-W, Cmd-Q and a logout
// become `closeRequest` and `quitRequest` events on `ngNativeWindows`, and the window closes or the
// app quits when the app says so (`close(surface)`, `answerQuit(proceed)`). With no app listening
// (a bundle that failed to load), they do what the OS would.
//
// Window frames autosave under the window's key (`main`, a route outlet, a `restoreKey`) in the
// app's preferences, and a window opened again with that key comes back where it was. A reload
// keeps the windows with a key for the reloaded app to claim, and closes the rest.
#pragma once

#include "ngn/native-module.h"
#include "ngn/system.h"

#include <react/renderer/core/ReactPrimitives.h>

#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

using facebook::react::SurfaceId;

enum class TitleBar { Default, Transparent, Hidden };

// A window's content rectangle in the OS's screen coordinates, in points.
struct WindowFrame {
  double x{0};
  double y{0};
  double width{0};
  double height{0};
  bool operator==(const WindowFrame &) const = default;
};

constexpr double kDefaultWindowWidth = 1040;
constexpr double kDefaultWindowHeight = 720;

// What the app asked to open (`NativeWindowRequest`). Sizes are content sizes in points.
struct WindowRequest {
  std::optional<std::string> key;
  std::string title;
  std::optional<double> width;
  std::optional<double> height;
  std::optional<double> minWidth;
  std::optional<double> minHeight;
  std::optional<double> maxWidth;
  std::optional<double> maxHeight;
  bool resizable{true};
  TitleBar titleBar{TitleBar::Default};
  bool fullScreen{false};
};

WindowRequest windowRequest(const folly::dynamic &request);

// Where a window opens: its saved frame (`restored`), or the size it asked for with the origin left
// to the backend, which cascades it.
struct WindowPlacement {
  WindowFrame frame;
  bool restored{false};
};

enum class QuitReply {
  // Quit now: nothing is listening, or the app already agreed.
  Now,
  // The app was asked; the backend waits for `replyToQuit`.
  Later,
  Cancel,
};

// What a backend does with windows. Called on any thread; the backend moves to its UI thread.
class WindowBackend {
 public:
  virtual ~WindowBackend() = default;
  // Make the window for `surface` and start the surface. `opened` is called once the surface can
  // take commits. The window shows when the surface's first frame mounts.
  virtual void openWindow(
      SurfaceId surface,
      const WindowRequest &request,
      const WindowPlacement &placement,
      std::function<void()> opened) = 0;
  // Close the window without asking, and stop its surface.
  virtual void closeWindow(SurfaceId surface) = 0;
  virtual void focusWindow(SurfaceId surface) = 0;
  virtual void setWindowTitle(SurfaceId surface, const std::string &title) = 0;
  // Start quitting as the OS's quit command does, which comes back through `quitRequested`.
  virtual void beginQuit() = 0;
  // Answer a quit that `quitRequested` deferred.
  virtual void replyToQuit(bool proceed) = 0;
  // Run `task` on the UI thread after `seconds`.
  virtual void after(double seconds, std::function<void()> task) = 0;
};

class WindowHost {
 public:
  // Events for the app: what the module sends as `ngNativeWindows`.
  using Listener = std::function<void(const folly::dynamic &event)>;

  WindowHost(std::shared_ptr<WindowBackend> backend, std::shared_ptr<System> system);

  // --- what the app asks (any thread) ---
  void open(const WindowRequest &request, std::function<void(SurfaceId)> done);
  void close(SurfaceId surface);
  void focus(SurfaceId surface);
  void setTitle(SurfaceId surface, const std::string &title);
  void quit();
  void answerQuit(bool proceed);

  // --- what the OS reports (the backend's UI thread) ---
  // The close button or Cmd-W. True to let the OS close the window now: the app is not listening,
  // or the window is not one of the app's.
  bool closeRequested(SurfaceId surface);
  // The OS's quit command or a logout.
  QuitReply quitRequested();
  // The key window, or none when the app has none.
  void focused(std::optional<SurfaceId> surface);
  void resized(SurfaceId surface, const WindowFrame &frame, double scale);
  void moved(SurfaceId surface, const WindowFrame &frame);
  // The app was opened again, or its Dock icon clicked.
  void reopen(bool hasVisibleWindows);

  // --- reloads ---
  // A runtime's module starts listening. After the first, the app has reloaded (from the menu or
  // the dev server): the windows with no key close, and the rest wait for the app to `open` their
  // key again, for `kClaimSeconds`, before they close too.
  std::shared_ptr<void> attach(Listener listener);
  static constexpr double kClaimSeconds = 5;

  std::vector<SurfaceId> surfaces() const;
  std::optional<SurfaceId> focusedSurface() const;


 private:
  struct Window {
    std::optional<std::string> key;
    bool kept{false};
  };
  void send(const folly::dynamic &event);
  void autosave(SurfaceId surface, const WindowFrame &frame);
  void reloading();
  void dropUnclaimed();
  WindowPlacement placement(const WindowRequest &request);

  std::shared_ptr<WindowBackend> backend_;
  std::shared_ptr<System> system_;
  mutable std::mutex mutex_;
  std::map<SurfaceId, Window> windows_;
  SurfaceId next_{11};
  std::optional<SurfaceId> focused_;
  bool quitAsked_{false};
  bool quitAgreed_{false};
  std::map<int, Listener> listeners_;
  int nextListener_{0};
  bool attached_{false};
};

// The `NgNativeWindows` module over `host`, one per runtime.
std::shared_ptr<NativeModule> makeWindowsModule(std::shared_ptr<WindowHost> host);

} // namespace ngn
