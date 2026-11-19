#include "focus.h"

#include "gtk-backend.h"
#include "text-field.h"
#include "view-widget.h"

#include "ngn/focus-order.h"

#include <react/renderer/core/RawEvent.h>

#include <optional>

namespace ngn::gtk {

namespace {

// Whether the focus moving now was moved by a key, which makes it focus-visible.
bool gKeyMove = false;

// The view the focus is on, or in: the nearest view at or above the focused widget.
std::optional<Tag> focusedView(GtkWidget *focus) {
  for (GtkWidget *w = focus; w; w = gtk_widget_get_parent(w)) {
    if (const ViewData *d = viewData(w); d && d->tag >= 0 && !d->surface) {
      return d->tag;
    }
  }
  return std::nullopt;
}

// The root view of the window's surface: the first surface widget in it.
std::optional<Tag> surfaceRoot(GtkWidget *widget) {
  if (const ViewData *d = viewData(widget); d && d->surface) {
    return d->surfaceId;
  }
  for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
    if (auto root = surfaceRoot(c)) {
      return root;
    }
  }
  return std::nullopt;
}

struct Context {
  std::optional<Tag> root;
  std::optional<Tag> focused;
  // A presentation's, whose Tab order Tab never leaves.
  bool contained{false};
};

Context contextOf(GtkWindow *window, GtkBackend &backend, const ViewTree &tree) {
  Context c;
  GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(window));
  c.focused = focus ? focusedView(focus) : std::nullopt;
  c.root = c.focused ? std::optional(focusContainer(tree, *c.focused)) : surfaceRoot(GTK_WIDGET(window));
  // The presentation in front of the window keeps the focus inside it.
  if (auto front = backend.modals().front(window); front && c.root != front) {
    bool inside = false;
    for (Tag at = c.focused.value_or(-1); const auto *node = tree.find(at); at = node->parent) {
      inside = inside || at == *front;
    }
    if (!inside) {
      c.root = front;
      c.focused.reset();
    }
  }
  c.contained = c.root && backend.modals().slotOf(*c.root) != nullptr;
  return c;
}

bool grab(GtkWidget *widget) {
  // A key moved it: GTK draws its focus ring, as AppKit does for a focus from the keyboard.
  if (GtkRoot *root = gtk_widget_get_root(widget); root && GTK_IS_WINDOW(root)) {
    gtk_window_set_focus_visible(GTK_WINDOW(root), TRUE);
  }
  gKeyMove = true;
  bool taken = gtk_widget_is_sensitive(widget) && gtk_widget_grab_focus(widget);
  gKeyMove = false;
  return taken;
}

std::optional<CompositeKey> compositeKey(guint keyval) {
  switch (keyval) {
    case GDK_KEY_Left:
    case GDK_KEY_KP_Left:
      return CompositeKey::Left;
    case GDK_KEY_Right:
    case GDK_KEY_KP_Right:
      return CompositeKey::Right;
    case GDK_KEY_Up:
    case GDK_KEY_KP_Up:
      return CompositeKey::Up;
    case GDK_KEY_Down:
    case GDK_KEY_KP_Down:
      return CompositeKey::Down;
    case GDK_KEY_Home:
    case GDK_KEY_KP_Home:
      return CompositeKey::Home;
    case GDK_KEY_End:
    case GDK_KEY_KP_End:
      return CompositeKey::End;
    default:
      return std::nullopt;
  }
}

void send(GtkWidget *widget, bool focused) {
  const ViewData *d = viewData(widget);
  if (!d || !d->emitter || d->tag < 0) {
    return;
  }
  folly::dynamic payload = folly::dynamic::object("target", d->tag);
  if (focused) {
    payload["focusVisible"] = gKeyMove;
  }
  d->emitter->dispatchEvent(focused ? "focus" : "blur", std::move(payload), facebook::react::RawEvent::Category::Discrete);
}

} // namespace

GtkWidget *focusWidget(const ViewData &view) {
  if (view.field) {
    return fieldWidget(*view.field);
  }
  return view.control ? view.control : view.widget;
}

void applyFocusable(GtkWidget *widget, const ViewData &view) {
  if (!view.field && !view.control) {
    gtk_widget_set_focusable(widget, viewTakesFocus(view.desktop));
  }
}

void watchFocus(GtkWidget *widget) {
  // A plain view's focus ring, drawn while the focus came from the keyboard.
  static bool styled = false;
  if (!styled && gdk_display_get_default()) {
    styled = true;
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(
        css, "ngn-view.ngn-focused:focus-visible { outline: 2px solid alpha(@accent_bg_color, 0.5); outline-offset: 1px; }", -1);
    gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
  }
  // A click focuses the innermost view under it that takes the focus, as AppKit's first responder
  // follows a click: an inner one took it already as the press bubbled up.
  GtkGesture *click = gtk_gesture_click_new();
  gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(click), GDK_BUTTON_PRIMARY);
  g_signal_connect(click, "pressed", G_CALLBACK(+[](GtkGestureClick *g, int, double, double, gpointer) {
    GtkWidget *view = gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(g));
    GtkRoot *root = gtk_widget_get_root(view);
    GtkWidget *focus = root ? gtk_root_get_focus(root) : nullptr;
    if (gtk_widget_get_focusable(view) && focus != view && !(focus && gtk_widget_is_ancestor(focus, view))) {
      gtk_widget_grab_focus(view);
    }
    gtk_gesture_set_state(GTK_GESTURE(g), GTK_EVENT_SEQUENCE_DENIED);
  }), nullptr);
  gtk_widget_add_controller(widget, GTK_EVENT_CONTROLLER(click));
}

void trackFocus(GtkWindow *window) {
  if (g_object_get_data(G_OBJECT(window), "ngn-focus")) {
    return;
  }
  // The view that had the focus, held weakly, which hears its blur as the focus moves on.
  auto *last = g_new0(GWeakRef, 1);
  g_weak_ref_init(last, nullptr);
  g_object_set_data_full(G_OBJECT(window), "ngn-focus", last, [](gpointer p) {
    g_weak_ref_clear(static_cast<GWeakRef *>(p));
    g_free(p);
  });
  // The window's focus widget changes however the focus moved, whether or not the window is
  // active, which GTK's focus controllers wait for.
  g_signal_connect(window, "notify::focus-widget", G_CALLBACK(+[](GtkWindow *w, GParamSpec *, gpointer) {
    auto *held = static_cast<GWeakRef *>(g_object_get_data(G_OBJECT(w), "ngn-focus"));
    GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(w));
    GtkWidget *view = focus && viewData(focus) ? focus : nullptr;
    auto *previous = static_cast<GtkWidget *>(g_weak_ref_get(held));
    if (previous == view) {
      g_clear_object(&previous);
      return;
    }
    // A view whose widget was replaced as its role changed keeps the focus: it hears neither.
    bool same = previous && view && g_object_get_data(G_OBJECT(previous), "ngn-replaced-by") == view;
    if (previous) {
      gtk_widget_remove_css_class(previous, "ngn-focused");
      if (!same) {
        send(previous, false);
      }
      g_object_unref(previous);
    }
    g_weak_ref_set(held, view);
    if (view) {
      // The ring is the focused view's own, not its ancestors', which GTK marks focus-visible too.
      gtk_widget_add_css_class(view, "ngn-focused");
      if (!same) {
        send(view, true);
      }
    }
  }), nullptr);
}

bool moveFocusByKey(GtkWindow *window, guint keyval, GdkModifierType state, GtkBackend &backend, const ViewTree &tree) {
  auto mods = state & (GDK_CONTROL_MASK | GDK_ALT_MASK | GDK_SUPER_MASK | GDK_SHIFT_MASK);
  bool tab = keyval == GDK_KEY_Tab || keyval == GDK_KEY_ISO_Left_Tab || keyval == GDK_KEY_KP_Tab;
  if (tab && (mods & ~GDK_SHIFT_MASK) == 0) {
    auto c = contextOf(window, backend, tree);
    if (!c.root) {
      return false;
    }
    // Shift+Tab arrives as ISO_Left_Tab.
    bool backwards = keyval == GDK_KEY_ISO_Left_Tab || (mods & GDK_SHIFT_MASK);
    std::optional<Tag> from = c.focused;
    auto count = tabOrder(tree, *c.root, TabReach::All, from).size();
    // A view whose widget takes no focus (a disabled control) passes Tab on.
    for (size_t tries = 0; tries < count; tries++) {
      auto next = nextInTabOrder(tree, *c.root, from, backwards, TabReach::All);
      if (!next) {
        break;
      }
      if (const ViewData *d = backend.data(*next); d && grab(focusWidget(*d))) {
        return true;
      }
      from = next;
    }
    return c.contained;
  }
  auto key = compositeKey(keyval);
  if (!key || (mods & ~GDK_CONTROL_MASK) != 0) {
    return false;
  }
  auto c = contextOf(window, backend, tree);
  GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(window));
  const ViewData *focused = c.focused ? backend.data(*c.focused) : nullptr;
  // On the view itself: a text field or a control inside it keeps its arrows.
  if (!c.root || !focused || focus != focused->widget) {
    return false;
  }
  auto next = compositeMove(tree, *c.root, *c.focused, *key, (mods & GDK_CONTROL_MASK) != 0);
  if (!next) {
    return false;
  }
  if (*next != *c.focused) {
    if (const ViewData *d = backend.data(*next)) {
      grab(focusWidget(*d));
    }
  }
  return true;
}

} // namespace ngn::gtk
