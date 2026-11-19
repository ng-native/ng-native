#include "input-replay.h"

#include "app-windows.h"

#include <dlfcn.h>

#include <cmath>
#include <cstdio>
#include <functional>
#include <memory>
#include <vector>

#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#include <X11/keysym.h>
#endif

namespace ngn::gtk {

namespace {

#ifdef GDK_WINDOWING_X11

// libXtst's calls, found at run time.
struct XTest {
  int (*motion)(Display *, int screen, int x, int y, unsigned long delay){nullptr};
  int (*button)(Display *, unsigned button, Bool press, unsigned long delay){nullptr};
  int (*key)(Display *, unsigned keycode, Bool press, unsigned long delay){nullptr};
  Bool (*query)(Display *, int *event, int *error, int *major, int *minor){nullptr};
  explicit operator bool() const {
    return motion && button && key && query;
  }
};

const XTest &xtest() {
  static XTest found = [] {
    XTest t;
    void *lib = dlopen("libXtst.so.6", RTLD_NOW | RTLD_LOCAL);
    if (lib) {
      t.motion = reinterpret_cast<decltype(t.motion)>(dlsym(lib, "XTestFakeMotionEvent"));
      t.button = reinterpret_cast<decltype(t.button)>(dlsym(lib, "XTestFakeButtonEvent"));
      t.key = reinterpret_cast<decltype(t.key)>(dlsym(lib, "XTestFakeKeyEvent"));
      t.query = reinterpret_cast<decltype(t.query)>(dlsym(lib, "XTestQueryExtension"));
    }
    return t;
  }();
  return found;
}

struct Replay {
  // Cleared if the window goes before the script ends.
  GtkWidget *window{nullptr};
  InputScript script;
  size_t at{0};
  std::function<void()> done;
  // Set when the window unrealizes: a destroyed window a caller still holds is not a finished script.
  bool closed{false};
  gulong unrealizeHandler{0};
  ~Replay() {
    if (window) {
      if (unrealizeHandler) {
        g_signal_handler_disconnect(window, unrealizeHandler);
      }
      g_object_remove_weak_pointer(G_OBJECT(window), reinterpret_cast<gpointer *>(&window));
    }
  }
};

Display *displayOf(GtkWidget *window) {
  return gdk_x11_display_get_xdisplay(gtk_widget_get_display(window));
}

// A point in the window's content, in points from its top left, on the root window in pixels.
std::pair<int, int> onRoot(GtkWidget *window, double x, double y) {
  GtkNative *native = gtk_widget_get_native(window);
  GdkSurface *surface = gtk_native_get_surface(native);
  double tx = 0, ty = 0;
  // The content's place in the surface, past a client-side shadow.
  gtk_native_get_surface_transform(native, &tx, &ty);
  int scale = gdk_surface_get_scale_factor(surface);
  Display *display = displayOf(window);
  Window child = 0;
  int rx = 0, ry = 0;
  XTranslateCoordinates(
      display, gdk_x11_surface_get_xid(surface), DefaultRootWindow(display), static_cast<int>(std::lround((x + tx) * scale)),
      static_cast<int>(std::lround((y + ty) * scale)), &rx, &ry, &child);
  return {rx, ry};
}

void pointerTo(GtkWidget *window, const InputStep &step) {
  auto [x, y] = onRoot(window, step.x, step.y);
  xtest().motion(displayOf(window), -1, x, y, 0);
}

// The X keysym a script's key names: a character, or escape, return, space, tab, delete or an arrow.
unsigned long keysymOf(const std::string &key) {
  if (key == "left") return XK_Left;
  if (key == "right") return XK_Right;
  if (key == "up") return XK_Up;
  if (key == "down") return XK_Down;
  if (key == "escape") return XK_Escape;
  if (key == "return") return XK_Return;
  if (key == "space") return XK_space;
  if (key == "tab") return XK_Tab;
  if (key == "delete") return XK_BackSpace;
  gunichar c = g_utf8_get_char(key.c_str());
  return gdk_unicode_to_keyval(c);
}

// The key that types `keysym` in the keyboard map's first group, and its level: 0 alone, 1 with
// Shift, 2 with AltGr (ISO_Level3_Shift), 3 with both. None when no key in that group types it.
std::optional<GdkKeymapKey> keyFor(GdkDisplay *display, unsigned long keysym) {
  GdkKeymapKey *keys = nullptr;
  int count = 0;
  std::optional<GdkKeymapKey> best;
  if (gdk_display_map_keyval(display, static_cast<guint>(keysym), &keys, &count)) {
    for (int i = 0; i < count; ++i) {
      if (keys[i].group == 0 && keys[i].level < 4 && (!best || keys[i].level < best->level)) {
        best = keys[i];
      }
    }
    g_free(keys);
  }
  return best;
}

// A key down and up, at the level that types it, with the script's modifiers held too: command is
// Linux's primary modifier, Ctrl.
void pressKey(GdkDisplay *gdkDisplay, unsigned long keysym, unsigned modifiers) {
  Display *display = gdk_x11_display_get_xdisplay(gdkDisplay);
  auto key = keyFor(gdkDisplay, keysym);
  unsigned level3 = key && key->level >= 2 ? XKeysymToKeycode(display, XK_ISO_Level3_Shift) : 0;
  if (!key || (key->level >= 2 && level3 == 0)) {
    fprintf(stderr, "[ngn] input script: no key for keysym 0x%lx\n", keysym);
    return;
  }
  std::vector<unsigned> held;
  if (modifiers & (InputStep::Command | InputStep::Control)) held.push_back(XKeysymToKeycode(display, XK_Control_L));
  if (modifiers & InputStep::Option) held.push_back(XKeysymToKeycode(display, XK_Alt_L));
  if ((modifiers & InputStep::Shift) || (key->level & 1)) held.push_back(XKeysymToKeycode(display, XK_Shift_L));
  if (level3) held.push_back(level3);
  for (unsigned m : held) xtest().key(display, m, True, 0);
  xtest().key(display, key->keycode, True, 0);
  xtest().key(display, key->keycode, False, 0);
  for (auto m = held.rbegin(); m != held.rend(); ++m) xtest().key(display, *m, False, 0);
}

void play(GtkWidget *window, const InputStep &step) {
  Display *display = displayOf(window);
  switch (step.kind) {
    case InputStep::Kind::Move:
    case InputStep::Kind::Drag:
      pointerTo(window, step);
      break;
    case InputStep::Kind::Down:
      pointerTo(window, step);
      xtest().button(display, 1, True, 0);
      break;
    case InputStep::Kind::Up:
      pointerTo(window, step);
      xtest().button(display, 1, False, 0);
      break;
    case InputStep::Kind::Secondary:
      pointerTo(window, step);
      xtest().button(display, 3, True, 0);
      xtest().button(display, 3, False, 0);
      break;
    case InputStep::Kind::Key:
      pressKey(gtk_widget_get_display(window), keysymOf(step.key), step.modifiers);
      break;
    case InputStep::Kind::Type: {
      for (const char *p = step.key.c_str(); *p; p = g_utf8_next_char(p)) {
        pressKey(gtk_widget_get_display(window), gdk_unicode_to_keyval(g_utf8_get_char(p)), 0);
      }
      break;
    }
    default:
      break;
  }
  XFlush(display);
}

// Plays from `replay->at`: a wait waits, and every other step leaves the loop a moment to take
// the event before the next, as a person's input arrives.
void playNext(std::shared_ptr<Replay> replay) {
  // A destroyed window that another reference keeps is unrealized, with no surface to post to; one
  // unrealized since the script began is closed even if something realizes it again.
  if (!replay->window || replay->closed || !gtk_widget_get_realized(replay->window)) {
    fprintf(stderr, "[ngn] input script: the window closed before the script ended\n");
    return;
  }
  if (replay->at >= replay->script.steps.size()) {
    fprintf(stderr, "[ngn] input script done\n");
    if (replay->done) {
      replay->done();
    }
    return;
  }
  const auto &step = replay->script.steps[replay->at++];
  if (step.kind == InputStep::Kind::Wait) {
    runAfter(step.amount / 1000, [replay] { playNext(replay); });
    return;
  }
  play(replay->window, step);
  runAfter(0.03, [replay] { playNext(replay); });
}

#endif

} // namespace

std::optional<std::string> inputReplayProblem(GtkWidget *window, const InputScript &script) {
  if (script.error) {
    return *script.error;
  }
  for (const auto &step : script.steps) {
    switch (step.kind) {
      case InputStep::Kind::Scroll:
      case InputStep::Kind::Magnify:
      case InputStep::Kind::Rotate:
      case InputStep::Kind::Choose:
        return "scroll, magnify, rotate and choose are not played on Linux";
      default:
        break;
    }
  }
#ifdef GDK_WINDOWING_X11
  if (!window || !GDK_IS_X11_DISPLAY(gtk_widget_get_display(window))) {
    return "an input script plays under X11 only";
  }
  return xtestProblem(displayOf(window));
#else
  return "an input script plays under X11 only";
#endif
}

#ifdef GDK_WINDOWING_X11
std::optional<std::string> xtestProblem(Display *display) {
  if (!xtest()) {
    return "libXtst.so.6 is not installed";
  }
  // Without the extension on the server, the library's calls post nothing and report no error.
  int event = 0, error = 0, major = 0, minor = 0;
  if (!xtest().query(display, &event, &error, &major, &minor)) {
    return "the X server has no XTEST extension";
  }
  return std::nullopt;
}
#endif

bool replayInputScript(GtkWidget *window, InputScript script, std::function<void()> done) {
  if (auto problem = inputReplayProblem(window, script)) {
    fprintf(stderr, "[ngn] input script: %s\n", problem->c_str());
    return false;
  }
#ifdef GDK_WINDOWING_X11
  auto replay = std::make_shared<Replay>();
  replay->window = window;
  replay->script = std::move(script);
  replay->done = std::move(done);
  g_object_add_weak_pointer(G_OBJECT(window), reinterpret_cast<gpointer *>(&replay->window));
  replay->unrealizeHandler = g_signal_connect(window, "unrealize", G_CALLBACK(+[](GtkWidget *, gpointer data) {
    static_cast<Replay *>(data)->closed = true;
  }), replay.get());
  playNext(std::move(replay));
  return true;
#else
  return false;
#endif
}

} // namespace ngn::gtk
