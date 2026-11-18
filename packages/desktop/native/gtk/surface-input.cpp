#include "surface-input.h"

#include <cmath>
#include <optional>

using facebook::react::Cursor;
using facebook::react::SurfaceId;

namespace ngn::gtk {

int ClickCounter::press(uint32_t timeMs, double x, double y, unsigned button) {
  bool continues = count_ > 0 && button == lastButton_ && timeMs - lastTime_ <= static_cast<uint32_t>(intervalMs_) &&
      std::abs(x - lastX_) <= distance_ && std::abs(y - lastY_) <= distance_;
  count_ = continues ? count_ + 1 : 1;
  lastTime_ = timeMs;
  lastX_ = x;
  lastY_ = y;
  lastButton_ = button;
  return count_;
}

int buttonBit(unsigned gdkButton) {
  switch (gdkButton) {
    case 1: return 1;
    case 2: return 4;
    case 3: return 2;
    case 8: return 8;
    case 9: return 16;
    default: return 0;
  }
}

const char *cursorName(Cursor cursor) {
  switch (cursor) {
    case Cursor::Auto: return nullptr;
    case Cursor::Alias: return "alias";
    case Cursor::AllScroll: return "all-scroll";
    case Cursor::Cell: return "cell";
    case Cursor::ColResize: return "col-resize";
    case Cursor::ContextMenu: return "context-menu";
    case Cursor::Copy: return "copy";
    case Cursor::Crosshair: return "crosshair";
    case Cursor::Default: return "default";
    case Cursor::EResize: return "e-resize";
    case Cursor::EWResize: return "ew-resize";
    case Cursor::Grab: return "grab";
    case Cursor::Grabbing: return "grabbing";
    case Cursor::Help: return "help";
    case Cursor::Move: return "move";
    case Cursor::NEResize: return "ne-resize";
    case Cursor::NESWResize: return "nesw-resize";
    case Cursor::NResize: return "n-resize";
    case Cursor::NSResize: return "ns-resize";
    case Cursor::NWResize: return "nw-resize";
    case Cursor::NWSEResize: return "nwse-resize";
    case Cursor::NoDrop: return "no-drop";
    case Cursor::None: return "none";
    case Cursor::NotAllowed: return "not-allowed";
    case Cursor::Pointer: return "pointer";
    case Cursor::Progress: return "progress";
    case Cursor::RowResize: return "row-resize";
    case Cursor::SResize: return "s-resize";
    case Cursor::SEResize: return "se-resize";
    case Cursor::SWResize: return "sw-resize";
    case Cursor::Text: return "text";
    // GTK has no `url` cursor: the pointing hand, as CSS's own fallback for a link.
    case Cursor::Url: return "pointer";
    case Cursor::WResize: return "w-resize";
    case Cursor::Wait: return "wait";
    case Cursor::ZoomIn: return "zoom-in";
    case Cursor::ZoomOut: return "zoom-out";
  }
  return nullptr;
}

namespace {

struct PointerState {
  GtkWidget *widget{nullptr};
  SurfaceId surfaceId{-1};
  ContainerId container{0};
  InputSink *input{nullptr};
  int buttons{0};
  ClickCounter clicks{400, 5};
};

// The event's point in the widget's coordinates: GDK gives it in the surface's.
std::optional<facebook::react::Point> pointIn(GtkWidget *widget, GdkEvent *event) {
  double x = 0, y = 0;
  if (!gdk_event_get_position(event, &x, &y)) {
    return std::nullopt;
  }
  GtkNative *native = gtk_widget_get_native(widget);
  if (!native) {
    return std::nullopt;
  }
  double tx = 0, ty = 0;
  gtk_native_get_surface_transform(native, &tx, &ty);
  graphene_point_t in, out;
  graphene_point_init(&in, static_cast<float>(x - tx), static_cast<float>(y - ty));
  if (!gtk_widget_compute_point(GTK_WIDGET(native), widget, &in, &out)) {
    return std::nullopt;
  }
  return facebook::react::Point{out.x, out.y};
}

std::optional<WheelDelta> wheelDelta(GdkEvent *event) {
  WheelDelta delta;
  switch (gdk_scroll_event_get_direction(event)) {
    case GDK_SCROLL_UP: delta.y = -1; delta.mode = 1; break;
    case GDK_SCROLL_DOWN: delta.y = 1; delta.mode = 1; break;
    case GDK_SCROLL_LEFT: delta.x = -1; delta.mode = 1; break;
    case GDK_SCROLL_RIGHT: delta.x = 1; delta.mode = 1; break;
    case GDK_SCROLL_SMOOTH: {
      gdk_scroll_event_get_deltas(event, &delta.x, &delta.y);
      // A wheel's clicks in lines; a touchpad's movement in pixels.
      delta.mode = gdk_scroll_event_get_unit(event) == GDK_SCROLL_UNIT_WHEEL ? 1 : 0;
      if (gdk_scroll_event_is_stop(event)) {
        delta.phase = GesturePhase::Ended;
      }
      break;
    }
  }
  if (delta.x == 0 && delta.y == 0 && !delta.phase) {
    return std::nullopt;
  }
  return delta;
}

gboolean pointerEvent(GtkEventControllerLegacy *, GdkEvent *event, gpointer user) {
  auto *s = static_cast<PointerState *>(user);
  GdkEventType type = gdk_event_get_event_type(event);
  if (type != GDK_BUTTON_PRESS && type != GDK_BUTTON_RELEASE && type != GDK_MOTION_NOTIFY && type != GDK_SCROLL) {
    return FALSE;
  }
  auto point = pointIn(s->widget, event);
  if (!point) {
    return FALSE;
  }
  PointerInput input;
  input.container = s->container;
  input.point = *point;
  // Wayland gives no position on the screen: the window's own stands in for it.
  input.screenPoint = *point;
  input.timestamp = gdk_event_get_time(event) / 1000.0;
  switch (type) {
    case GDK_BUTTON_PRESS: {
      guint button = gdk_button_event_get_button(event);
      s->buttons |= buttonBit(button);
      input.buttons = s->buttons;
      input.pressure = 0.5f;
      input.clickCount = s->clicks.press(gdk_event_get_time(event), point->x, point->y, button);
      if (button == 3 && s->input->contextMenu(input)) {
        return FALSE;
      }
      s->input->pointerDown(input);
      return FALSE;
    }
    case GDK_BUTTON_RELEASE:
      s->buttons &= ~buttonBit(gdk_button_event_get_button(event));
      input.buttons = s->buttons;
      s->input->pointerUp(input);
      return FALSE;
    case GDK_MOTION_NOTIFY:
      input.buttons = s->buttons;
      input.pressure = s->buttons ? 0.5f : 0;
      s->input->pointerMove(input);
      return FALSE;
    default: {
      auto delta = wheelDelta(event);
      if (!delta) {
        return FALSE;
      }
      // One a gesture handler took is not the view under it to scroll as well.
      return s->input->wheel(input, *delta).taken;
    }
  }
}

void pointerLeft(GtkEventControllerMotion *, gpointer user) {
  auto *s = static_cast<PointerState *>(user);
  PointerInput input;
  input.container = s->container;
  input.buttons = s->buttons;
  s->input->pointerLeave(s->surfaceId, input);
}

} // namespace

void attachPointerInput(GtkWidget *widget, SurfaceId surfaceId, ContainerId container, InputSink *input) {
  auto *state = new PointerState{.widget = widget, .surfaceId = surfaceId, .container = container, .input = input};
  int interval = 400, distance = 5;
  g_object_get(gtk_widget_get_settings(widget), "gtk-double-click-time", &interval, "gtk-double-click-distance", &distance, nullptr);
  state->clicks = ClickCounter(interval, distance);
  g_object_set_data_full(G_OBJECT(widget), "ngn-pointer", state, [](gpointer p) { delete static_cast<PointerState *>(p); });

  GtkEventController *legacy = gtk_event_controller_legacy_new();
  gtk_event_controller_set_propagation_phase(legacy, GTK_PHASE_CAPTURE);
  g_signal_connect(legacy, "event", G_CALLBACK(pointerEvent), state);
  gtk_widget_add_controller(widget, legacy);

  GtkEventController *motion = gtk_event_controller_motion_new();
  g_signal_connect(motion, "leave", G_CALLBACK(pointerLeft), state);
  gtk_widget_add_controller(widget, motion);
}

} // namespace ngn::gtk
