// Views mounted the way the host mounts them: Fabric mutations through the core's MountingManager
// into the GTK backend, in a surface widget filling a window that GTK draws, read back as pixels
// through the window's own renderer (capture.h). Input is in-process only: GDK takes no event
// from another process on a Mac, and has no public way to make one.
#pragma once

#include "../capture.h"
#include "../gtk-backend.h"
#include "../view-widget.h"

#include "helpers.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-manager.h"
#include "ngn/text-input.h"

#include <doctest/doctest.h>

#include <react/renderer/core/EventBeat.h>
#include <react/renderer/core/EventDispatcher.h>
#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/mounting/MountingTransaction.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>

#include <adwaita.h>
#include <gtk/gtk.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <ostream>
#include <set>
#include <string>
#include <memory>
#include <stdexcept>
#include <vector>

namespace ngn::testing {

// Props as a component's descriptor parses them from what the app commits.
template <typename Descriptor>
facebook::react::Props::Shared parsedProps(folly::dynamic raw) {
  static auto context = std::make_shared<const facebook::react::ContextContainer>();
  static Descriptor descriptor{{{}, context, nullptr}};
  facebook::react::PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, facebook::react::RawProps(std::move(raw)));
}

inline facebook::react::Props::Shared desktopViewProps(folly::dynamic raw) {
  return parsedProps<DesktopViewComponentDescriptor>(std::move(raw));
}

inline facebook::react::Props::Shared textInputProps(folly::dynamic raw) {
  return parsedProps<DesktopTextInputComponentDescriptor>(std::move(raw));
}

// GTK, once for the process, with its test accessibility backend, which keeps every role,
// property and state for gtk_test_accessible_* to read and needs no AT-SPI bus. False where there
// is no display to open.
inline bool gtkReady() {
  static bool ready = [] {
    g_setenv("GTK_A11Y", "test", TRUE);
    return gtk_init_check();
  }();
  return ready;
}

// Runs GLib's loop until `done`, or throws after five seconds.
template <typename Done>
void runUntil(Done done) {
  gint64 deadline = g_get_monotonic_time() + 5 * G_USEC_PER_SEC;
  while (!done()) {
    if (g_get_monotonic_time() > deadline) {
      throw std::runtime_error("the GTK main loop never got there");
    }
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(1000);
  }
}

// The events a view sends, by type, kept by a dispatcher's listener before any queue. The emitter
// replaces the view's own.
template <typename Emitter = facebook::react::EventEmitter>
struct SentEvents {
  facebook::react::RuntimeScheduler scheduler{[](auto &&) {}};
  std::shared_ptr<facebook::react::EventDispatcher> dispatcher;
  std::vector<std::string> types;

  std::shared_ptr<Emitter> emitter;

  // On the view's data, in place of its own emitter.
  explicit SentEvents(gtk::ViewData &view) : SentEvents() { view.emitter = emitter; }

  // For a view not made yet: its shadow's eventEmitter.
  SentEvents() {
    using namespace facebook::react;
    EventQueueProcessor processor([](auto &&...) {}, [](auto &&...) {}, [](auto &&...) {}, {});
    dispatcher = std::make_shared<EventDispatcher>(
        processor, std::make_unique<EventBeat>(std::make_shared<EventBeat::OwnerBox>(), scheduler), [](auto &&...) {},
        std::weak_ptr<EventLogger>());
    dispatcher->addListener(std::make_shared<const EventListener>([this](const RawEvent &event) {
      types.push_back(event.type);
      return true;
    }));
    emitter = std::make_shared<Emitter>(nullptr, dispatcher);
  }

  long count(const std::string &type) const {
    return std::count(types.begin(), types.end(), type);
  }
};

// An RGBA pixel, unpremultiplied.
struct Pixel {
  int r{0}, g{0}, b{0}, a{0};
};

// `widget`'s pixel at (x, y) in its points, as GTK draws it now.
inline Pixel widgetPixel(GtkWidget *widget, int x, int y) {
  GdkTexture *texture = gtk::renderWidget(widget);
  if (!texture) {
    throw std::runtime_error("the widget did not render");
  }
  int width = gdk_texture_get_width(texture);
  int height = gdk_texture_get_height(texture);
  int scale = width / std::max(1, gtk_widget_get_width(widget));
  std::vector<guchar> data(static_cast<size_t>(width) * height * 4);
  gdk_texture_download(texture, data.data(), static_cast<size_t>(width) * 4);
  // NGN_GTK_TEST_SHOTS=<dir> keeps each widget read, for a failure on a machine without a screen.
  if (const char *dir = getenv("NGN_GTK_TEST_SHOTS"); dir && *dir) {
    static int shot = 0;
    gdk_texture_save_to_png(texture, (std::string(dir) + "/shot-" + std::to_string(++shot) + ".png").c_str());
  }
  g_object_unref(texture);
  int px = std::clamp(x * scale + scale / 2, 0, width - 1);
  int py = std::clamp(y * scale + scale / 2, 0, height - 1);
  // GDK_MEMORY_DEFAULT: B, G, R, A, premultiplied.
  const guchar *p = &data[(static_cast<size_t>(py) * width + px) * 4];
  int a = p[3];
  auto un = [a](int c) { return a == 0 ? 0 : std::min(255, c * 255 / a); };
  return {un(p[2]), un(p[1]), un(p[0]), a};
}

struct MountedViews {
  static constexpr facebook::react::SurfaceId kSurface = 1;

  std::shared_ptr<gtk::GtkBackend> backend = std::make_shared<gtk::GtkBackend>();
  std::shared_ptr<MountingManager> mounting = std::make_shared<MountingManager>(backend, backend);
  GtkWidget *window = nullptr;
  GtkWidget *surface = nullptr;
  int frames = 0;

  // `chrome`: the surface in a header bar's AdwWindow, as the host's (screens.h), `width` by
  // `height` below it, or under it for a title bar `options` runs the content under.
  explicit MountedViews(bool chrome = false, int width = 200, int height = 200, gtk::ChromeOptions options = {}) {
    window = chrome ? adw_window_new() : gtk_window_new();
    gtk_window_set_default_size(GTK_WINDOW(window), width, height);
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    surface = gtk::makeSurfaceWidget(kSurface, nullptr);
    if (chrome) {
      gtk_widget_set_size_request(surface, width, height);
      adw_window_set_content(ADW_WINDOW(window), gtk::wrapInChrome(surface, options));
    } else {
      gtk_window_set_child(GTK_WINDOW(window), surface);
    }
    backend->addSurface(kSurface, surface);
    mount({facebook::react::ShadowViewMutation::CreateMutation(shadow(kSurface, "RootView", desktopViewProps(folly::dynamic::object()), {{0, 0}, {static_cast<facebook::react::Float>(width), static_cast<facebook::react::Float>(height)}}))});
    gtk_window_present(GTK_WINDOW(window));
    runUntil([this] { return gtk_widget_get_mapped(surface) && gtk_widget_get_frame_clock(surface); });
    g_signal_connect(gtk_widget_get_frame_clock(surface), "after-paint", G_CALLBACK(+[](GdkFrameClock *, gpointer self) {
      static_cast<MountedViews *>(self)->frames++;
    }), this);
  }

  ~MountedViews() {
    g_signal_handlers_disconnect_by_data(gtk_widget_get_frame_clock(surface), this);
    backend->removeSurface(kSurface);
    gtk_window_destroy(GTK_WINDOW(window));
  }

  MountedViews(const MountedViews &) = delete;
  MountedViews &operator=(const MountedViews &) = delete;

  static facebook::react::ShadowView shadow(
      facebook::react::Tag tag,
      const char *componentName,
      facebook::react::Props::Shared props,
      facebook::react::Rect frame) {
    auto view = shadowView(tag, componentName, frame, std::move(props));
    view.surfaceId = kSurface;
    return view;
  }

  // Applies the mutations as a commit does, then waits for GTK to have laid them out and drawn them.
  void mount(facebook::react::ShadowViewMutationList mutations) {
    mounting->executeMount(kSurface, facebook::react::MountingTransaction(kSurface, 1, std::move(mutations), {}));
    auto mounted = std::make_shared<bool>(false);
    backend->runOnUiThread([mounted] { *mounted = true; });
    runUntil([mounted] { return *mounted; });
    settle();
  }

  // Waits for two frames drawn after now: a widget parented during the first can be laid out only
  // in the next (GTK 4.12 under Xvfb draws one first with the old allocations).
  void settle() {
    if (!window || !gtk_widget_get_mapped(surface)) {
      return;
    }
    for (int i = 0; i < 2; ++i) {
      gtk_widget_queue_draw(surface);
      int seen = frames;
      runUntil([this, seen] { return frames > seen; });
    }
  }

  // Creates `view` and inserts it as the last child of `parent`, or at `index`.
  void add(const facebook::react::ShadowView &view, facebook::react::Tag parent = kSurface, int index = -1) {
    if (index < 0) {
      index = static_cast<int>(mounting->tree().find(parent)->children.size());
    }
    mount({facebook::react::ShadowViewMutation::CreateMutation(view),
           facebook::react::ShadowViewMutation::InsertMutation(parent, view, index)});
  }

  void update(const facebook::react::ShadowView &view, facebook::react::Props::Shared props) {
    auto current = mounting->tree().find(view.tag)->view;
    auto next = current;
    next.props = std::move(props);
    mount({facebook::react::ShadowViewMutation::UpdateMutation(current, next, kSurface)});
  }

  GtkWidget *view(facebook::react::Tag tag) const {
    return backend->view(tag);
  }

  // The surface's pixel at (x, y) in its points, as GTK draws it now.
  Pixel pixel(int x, int y) const {
    return widgetPixel(surface, x, y);
  }
};

inline std::ostream &operator<<(std::ostream &out, const Pixel &p) {
  return out << "rgba(" << p.r << ", " << p.g << ", " << p.b << ", " << p.a << ")";
}

// Whether `p` is mostly one colour, saying what it was when not.
inline bool mostly(const Pixel &p, int Pixel::*channel, const char *name) {
  bool ok = p.a > 200 && p.*channel > 200 && (p.r + p.g + p.b - p.*channel) < 120;
  if (!ok) {
    MESSAGE("expected " << std::string(name) << ", got " << p);
  }
  return ok;
}
inline bool reddish(const Pixel &p) {
  return mostly(p, &Pixel::r, "red");
}
inline bool bluish(const Pixel &p) {
  return mostly(p, &Pixel::b, "blue");
}
inline bool greenish(const Pixel &p) {
  return mostly(p, &Pixel::g, "green");
}

// Whether two pages of a stack in `widget` share a name. A sliding popover menu puts each
// submenu on a page named for its label and opens it by that name, so the second opens the first.
inline bool sharedPageName(GtkWidget *widget) {
  if (GTK_IS_STACK(widget)) {
    std::set<std::string> names;
    GListModel *pages = G_LIST_MODEL(gtk_stack_get_pages(GTK_STACK(widget)));
    bool shared = false;
    for (guint i = 0; i < g_list_model_get_n_items(pages); ++i) {
      auto *page = GTK_STACK_PAGE(g_list_model_get_item(pages, i));
      if (const char *name = gtk_stack_page_get_name(page)) {
        shared = shared || !names.insert(name).second;
      }
      g_object_unref(page);
    }
    g_object_unref(pages);
    if (shared) {
      return true;
    }
  }
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (sharedPageName(child)) {
      return true;
    }
  }
  return false;
}

// The model a menu button's popover menu draws.
inline GMenuModel *menuButtonModel(GtkWidget *button) {
  GtkPopover *popover = gtk_menu_button_get_popover(GTK_MENU_BUTTON(button));
  return GTK_IS_POPOVER_MENU(popover) ? gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover)) : nullptr;
}

} // namespace ngn::testing
