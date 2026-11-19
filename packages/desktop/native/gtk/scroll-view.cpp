#include "scroll-view.h"

#include <react/renderer/components/scrollview/ScrollViewEventEmitter.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>

#include <algorithm>
#include <utility>

using namespace facebook::react;

namespace ngn::gtk {

namespace {

ScrollOffsetChanged gOffsetChanged;

using ScrollState = ConcreteState<ScrollViewState>;

std::shared_ptr<const ScrollState> stateOf(const ViewData &view) {
  return std::dynamic_pointer_cast<const ScrollState>(view.state);
}

GtkAdjustment *horizontal(const ScrollBox &box) {
  return gtk_scrolled_window_get_hadjustment(GTK_SCROLLED_WINDOW(box.scrolled));
}

GtkAdjustment *vertical(const ScrollBox &box) {
  return gtk_scrolled_window_get_vadjustment(GTK_SCROLLED_WINDOW(box.scrolled));
}

Point offsetOf(const ScrollBox &box) {
  return {static_cast<Float>(gtk_adjustment_get_value(horizontal(box))), static_cast<Float>(gtk_adjustment_get_value(vertical(box)))};
}

// The part of the view the content shows through: the view less the classic scroll bars' strips.
Size viewportOf(const ScrollBox &box) {
  auto gutter = ScrollerGutters::shared().get(box.view->tag);
  const auto &frame = box.view->layout.frame.size;
  return {std::max<Float>(0, frame.width - gutter.right), std::max<Float>(0, frame.height - gutter.bottom)};
}

// Gives the view's state the content's offset now. React Native applies a state update later, on
// the state it then holds, and a later update of the same view replaces one not yet applied: each
// carries the offset GTK shows, compared with the state it is applied to, never with the one this
// view last mounted. `relayout` sends it even when the offset is the state's, for a clone that
// reads a new gutter, and so does each later update until one such clone is applied.
void syncState(const ScrollBox &box, bool relayout) {
  auto state = stateOf(*box.view);
  if (!state) {
    return;
  }
  if (relayout) {
    box.relayoutOwed->store(true);
  }
  Point offset = offsetOf(box);
  state->updateState([offset, owed = box.relayoutOwed](const ScrollViewState &old) -> StateData::Shared {
    if (!owed->exchange(false) && old.contentOffset == offset) {
      return nullptr;
    }
    auto data = std::make_shared<ScrollViewState>(old);
    data->contentOffset = offset;
    return data;
  });
}

void scrolled(GtkAdjustment *, gpointer user) {
  auto *box = static_cast<ScrollBox *>(user);
  if (!box->view) {
    return;
  }
  Point offset = offsetOf(*box);
  if (gOffsetChanged) {
    gOffsetChanged(box->view->tag, offset);
  }
  syncState(*box, false);
  if (auto emitter = std::dynamic_pointer_cast<const ScrollViewEventEmitter>(box->view->emitter)) {
    ScrollEvent event;
    event.contentOffset = offset;
    event.contentSize = box->content;
    event.containerSize = box->view->layout.frame.size;
    event.zoomScale = 1;
    event.timestamp = static_cast<double>(g_get_monotonic_time()) / G_USEC_PER_SEC;
    emitter->onScroll(event);
  }
}

// Moves the content to `target`, kept within it. The adjustments are given the content's and the
// viewport's sizes first, which GTK's own layout gives them only on the next frame.
void moveTo(ScrollBox &box, Point target) {
  Size page = viewportOf(box);
  auto set = [](GtkAdjustment *adjustment, double value, double content, double page) {
    double upper = std::max(content, page);
    gtk_adjustment_configure(adjustment, std::clamp(value, 0.0, upper - page), 0, upper, page * 0.1, page * 0.9, page);
  };
  set(horizontal(box), target.x, box.content.width, page.width);
  set(vertical(box), target.y, box.content.height, page.height);
}

// The starting offset the props ask for, within the content, once there is content to scroll.
void applyPendingOffset(ScrollBox &box) {
  Size page = viewportOf(box);
  if (!box.pendingOffset || box.content.width <= 0 || box.content.height <= 0 || page.width <= 0 || page.height <= 0) {
    return;
  }
  Point target = *box.pendingOffset;
  box.pendingOffset.reset();
  moveTo(box, target);
}

// After the rest of this mount: its state and its layout, which come after the props, give the
// content's size and the view's. Once, however many of them change.
void applyPendingOffsetAfterMount(ScrollBox &box) {
  if (!box.pendingOffset || box.pendingSource != 0) {
    return;
  }
  box.pendingSource = g_idle_add_full(
      G_PRIORITY_DEFAULT,
      [](gpointer user) -> gboolean {
        auto *box = static_cast<ScrollBox *>(user);
        box->pendingSource = 0;
        applyPendingOffset(*box);
        return G_SOURCE_REMOVE;
      },
      &box, nullptr);
}

// GTK's wheel, drag and kinetic controllers on the scrolled window, on or off. Off, the wheel goes
// on to a scroll view around it, as on macOS.
void enableControllers(ScrollBox &box, bool enabled) {
  if (box.enabled == enabled) {
    return;
  }
  box.enabled = enabled;
  for (auto &[controller, phase] : box.controllers) {
    // GTK moves some of them itself (the drag gesture follows kinetic scrolling): each goes back to
    // the phase it had as it was turned off.
    if (!enabled) {
      phase = gtk_event_controller_get_propagation_phase(controller);
    }
    gtk_event_controller_set_propagation_phase(controller, enabled ? phase : GTK_PHASE_NONE);
  }
}

} // namespace

void onScrollOffset(ScrollOffsetChanged changed) {
  gOffsetChanged = std::move(changed);
}

ScrollerStyle scrollerStyle(GtkWidget *widget) {
  gboolean overlay = TRUE;
  g_object_get(gtk_widget_get_settings(widget), "gtk-overlay-scrolling", &overlay, nullptr);
  return overlay ? ScrollerStyle::Overlay : ScrollerStyle::Legacy;
}

float classicScrollerWidth(GtkWidget *scrolled) {
  int minimum = 0, natural = 0;
  GtkWidget *bar = gtk_scrolled_window_get_vscrollbar(GTK_SCROLLED_WINDOW(scrolled));
  gtk_widget_measure(bar, GTK_ORIENTATION_HORIZONTAL, -1, &minimum, &natural, nullptr, nullptr);
  return static_cast<float>(natural);
}

void makeScrollView(GtkWidget *widget, ViewData &view) {
  auto *box = new ScrollBox();
  box->view = &view;
  box->scrolled = gtk_scrolled_window_new();
  box->document = makeViewWidget();
  viewData(box->document)->documentOf = box;
  gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(box->scrolled), box->document);
  gtk_scrolled_window_set_propagate_natural_width(GTK_SCROLLED_WINDOW(box->scrolled), FALSE);
  gtk_scrolled_window_set_propagate_natural_height(GTK_SCROLLED_WINDOW(box->scrolled), FALSE);
  gtk_widget_set_parent(box->scrolled, widget);
  GListModel *controllers = gtk_widget_observe_controllers(box->scrolled);
  for (guint i = 0, n = g_list_model_get_n_items(controllers); i < n; ++i) {
    auto *controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
    box->controllers.emplace_back(controller, gtk_event_controller_get_propagation_phase(controller));
    // The scrolled window keeps it.
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  g_signal_connect(horizontal(*box), "value-changed", G_CALLBACK(scrolled), box);
  g_signal_connect(vertical(*box), "value-changed", G_CALLBACK(scrolled), box);
  view.scroll = box;
  applyScrollViewProps(view);
}

void destroyScrollView(ViewData &view) {
  ScrollBox *box = std::exchange(view.scroll, nullptr);
  if (!box) {
    return;
  }
  if (box->pendingSource != 0) {
    g_source_remove(box->pendingSource);
  }
  g_signal_handlers_disconnect_by_data(horizontal(*box), box);
  g_signal_handlers_disconnect_by_data(vertical(*box), box);
  if (ViewData *document = viewData(box->document)) {
    document->documentOf = nullptr;
  }
  ScrollerGutters::shared().remove(view.tag);
  if (gtk_widget_get_parent(box->scrolled)) {
    gtk_widget_unparent(box->scrolled);
  }
  delete box;
}

GtkWidget *contentWidget(GtkWidget *widget) {
  ViewData *view = viewData(widget);
  return view && view->scroll ? view->scroll->document : widget;
}

void applyScrollViewProps(ViewData &view) {
  auto props = std::dynamic_pointer_cast<const ScrollViewProps>(view.props);
  ScrollBox *box = view.scroll;
  if (!props || !box) {
    return;
  }
  box->showsVertical = props->showsVerticalScrollIndicator;
  box->showsHorizontal = props->showsHorizontalScrollIndicator;
  enableControllers(*box, props->scrollEnabled);
  updateScrollers(view);
  if (box->offsetProp != props->contentOffset) {
    bool first = !box->offsetProp;
    box->offsetProp = props->contentOffset;
    if (!first || props->contentOffset != Point{}) {
      box->pendingOffset = props->contentOffset;
    }
    applyPendingOffsetAfterMount(*box);
  }
}

void applyScrollViewState(ViewData &view) {
  ScrollBox *box = view.scroll;
  auto state = stateOf(view);
  if (!box || !state) {
    return;
  }
  Size content = state->getData().getContentSize();
  if (content != box->content) {
    box->content = content;
    gtk_widget_queue_resize(box->document);
  }
  updateScrollers(view);
  applyPendingOffsetAfterMount(*box);
}

void updateScrollers(ViewData &view) {
  ScrollBox *box = view.scroll;
  if (!box) {
    return;
  }
  auto visibility = scrollerVisibility(view.desktop, box->showsVertical, box->showsHorizontal, box->content, view.layout.frame.size);
  auto policy = [&visibility](bool shown) {
    // A scroll bar not shown still scrolls, by the wheel and the keyboard.
    return !shown ? GTK_POLICY_EXTERNAL : visibility.autohides ? GTK_POLICY_AUTOMATIC : GTK_POLICY_ALWAYS;
  };
  gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(box->scrolled), policy(visibility.horizontal), policy(visibility.vertical));
  auto style = scrollerStyle(box->scrolled);
  auto gutter = scrollerGutter(style, style == ScrollerStyle::Legacy ? classicScrollerWidth(box->scrolled) : 0, visibility);
  // Recorded only once there is a state to update, so a gutter is never recorded that no layout
  // has asked for. A state update clones the scroll view's node, which reads its gutter.
  if (stateOf(view) && ScrollerGutters::shared().set(view.tag, gutter)) {
    syncState(*box, true);
  }
}

void allocateScrollView(ViewData &view, int width, int height) {
  if (view.scroll) {
    gtk_widget_allocate(view.scroll->scrolled, width, height, -1, nullptr);
    // A starting offset that waited for a view with a size is tried again once it has one.
    applyPendingOffsetAfterMount(*view.scroll);
  }
}

void scrollViewCommand(ViewData &view, const std::string &name, const folly::dynamic &args) {
  ScrollBox *box = view.scroll;
  if (!box) {
    return;
  }
  if (name == "scrollTo" && args.isArray() && args.size() >= 2 && args[0].isNumber() && args[1].isNumber()) {
    moveTo(*box, {static_cast<Float>(args[0].asDouble()), static_cast<Float>(args[1].asDouble())});
  } else if (name == "scrollToEnd") {
    Size page = viewportOf(*box);
    Point target = offsetOf(*box);
    // The end along the axis the content overflows, down before across, as on macOS.
    if (box->content.height > page.height) {
      target.y = box->content.height - page.height;
    } else {
      target.x = std::max<Float>(0, box->content.width - page.width);
    }
    moveTo(*box, target);
  }
}

} // namespace ngn::gtk
