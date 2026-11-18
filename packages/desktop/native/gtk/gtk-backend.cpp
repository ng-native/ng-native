#include "gtk-backend.h"

#include "text-field.h"
#include "view-widget.h"

#include "ngn/library-components.h"

#include <react/renderer/components/view/ViewProps.h>

namespace ngn::gtk {

namespace {

void applyViewProps(GtkWidget *widget, const ViewData &data) {
  if (auto props = std::dynamic_pointer_cast<const facebook::react::ViewProps>(data.props)) {
    gtk_widget_set_opacity(widget, props->opacity);
  }
}

// The parent places the view (its frame and transform); the view lays out its own children and
// draws itself again.
void relayout(GtkWidget *widget) {
  if (GtkWidget *parent = gtk_widget_get_parent(widget)) {
    gtk_widget_queue_allocate(parent);
  }
  gtk_widget_queue_allocate(widget);
  gtk_widget_queue_draw(widget);
}

} // namespace

GtkBackend::GtkBackend() : uiThread_(std::this_thread::get_id()) {}

GtkBackend::~GtkBackend() {
  {
    std::lock_guard lock(tasksMutex_);
    if (drainSource_ != 0) {
      g_source_remove(drainSource_);
      drainSource_ = 0;
    }
  }
  for (auto &[tag, widget] : views_) {
    if (gtk_widget_get_parent(widget)) {
      gtk_widget_unparent(widget);
    }
    g_object_unref(widget);
  }
}

void GtkBackend::addSurface(SurfaceId surfaceId, GtkWidget *surface) {
  surfaces_[surfaceId] = surface;
}

void GtkBackend::removeSurface(SurfaceId surfaceId) {
  surfaces_.erase(surfaceId);
}

GtkWidget *GtkBackend::view(Tag tag) const {
  auto it = views_.find(tag);
  return it == views_.end() ? nullptr : it->second;
}

void GtkBackend::runOnUiThread(std::function<void()> task) {
  std::lock_guard lock(tasksMutex_);
  tasks_.push_back(std::move(task));
  if (drainSource_ == 0) {
    // One idle at the default priority, above GDK's redraw, drains the queue in order.
    drainSource_ = g_idle_add_full(
        G_PRIORITY_DEFAULT,
        [](gpointer self) -> gboolean {
          static_cast<GtkBackend *>(self)->drain();
          return G_SOURCE_REMOVE;
        },
        this, nullptr);
  }
}

void GtkBackend::drain() {
  std::deque<std::function<void()>> tasks;
  {
    std::lock_guard lock(tasksMutex_);
    tasks.swap(tasks_);
    drainSource_ = 0;
  }
  for (auto &task : tasks) {
    task();
  }
}

bool GtkBackend::onUiThread() const {
  return std::this_thread::get_id() == uiThread_;
}

void GtkBackend::serviceUiThread() {
  drain();
  g_main_context_iteration(nullptr, FALSE);
}

void GtkBackend::createView(const ShadowView &view) {
  GtkWidget *widget = makeViewWidget();
  g_object_ref_sink(widget);
  ViewData *d = viewData(widget);
  d->tag = view.tag;
  d->component = view.componentName;
  d->props = view.props;
  d->state = view.state;
  d->emitter = view.eventEmitter;
  d->layout = view.layoutMetrics;
  if (d->component == "TextInput") {
    makeTextField(widget, *d);
  }
  applyViewProps(widget, *d);
  views_[view.tag] = widget;
  if (view.tag == view.surfaceId) {
    if (auto it = surfaces_.find(view.surfaceId); it != surfaces_.end()) {
      gtk_widget_set_parent(widget, it->second);
    }
  }
}

void GtkBackend::deleteView(SurfaceId, Tag tag) {
  auto it = views_.find(tag);
  if (it == views_.end()) {
    return;
  }
  if (gtk_widget_get_parent(it->second)) {
    gtk_widget_unparent(it->second);
  }
  g_object_unref(it->second);
  views_.erase(it);
}

void GtkBackend::insertChild(SurfaceId, Tag parent, Tag child, int index) {
  auto p = views_.find(parent), c = views_.find(child);
  if (p == views_.end() || c == views_.end()) {
    return;
  }
  if (gtk_widget_get_parent(c->second)) {
    gtk_widget_unparent(c->second);
  }
  // Fabric's order is the drawing order. The index counts views only: a TextInput's field is a
  // child of its own, after them.
  GtkWidget *sibling = gtk_widget_get_first_child(p->second);
  for (int i = 0; sibling; sibling = gtk_widget_get_next_sibling(sibling)) {
    if (!NGN_IS_VIEW(sibling) || i++ == index) {
      break;
    }
  }
  gtk_widget_insert_before(c->second, p->second, sibling);
}

void GtkBackend::removeChild(SurfaceId, Tag, Tag child, int) {
  if (auto c = views_.find(child); c != views_.end() && gtk_widget_get_parent(c->second)) {
    gtk_widget_unparent(c->second);
  }
}

void GtkBackend::updateProps(const ShadowView &view) {
  auto it = views_.find(view.tag);
  if (it == views_.end()) {
    return;
  }
  ViewData *d = viewData(it->second);
  d->props = view.props;
  forgetText(*d);
  applyViewProps(it->second, *d);
  applyTextFieldProps(*d);
  relayout(it->second);
}

void GtkBackend::updateState(const ShadowView &view) {
  if (auto it = views_.find(view.tag); it != views_.end()) {
    ViewData *d = viewData(it->second);
    d->state = view.state;
    forgetText(*d);
    gtk_widget_queue_draw(it->second);
  }
}

void GtkBackend::updateLayout(const ShadowView &view) {
  if (auto it = views_.find(view.tag); it != views_.end()) {
    ViewData *d = viewData(it->second);
    d->layout = view.layoutMetrics;
    forgetText(*d);
    // A field's natural alignment follows the layout's direction.
    applyTextFieldProps(*d);
    relayout(it->second);
  }
}

void GtkBackend::updateEventEmitter(const ShadowView &view) {
  if (auto it = views_.find(view.tag); it != views_.end()) {
    viewData(it->second)->emitter = view.eventEmitter;
  }
}

void GtkBackend::dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) {
  if (auto it = views_.find(tag); it != views_.end()) {
    textFieldCommand(*viewData(it->second), name, args);
  }
}

void GtkBackend::setCovered(SurfaceId, Tag tag, bool covered) {
  if (auto it = views_.find(tag); it != views_.end()) {
    gtk_widget_set_child_visible(it->second, !covered);
  }
}

void GtkBackend::didMount(SurfaceId surfaceId) {
  if (onMount) {
    onMount(surfaceId);
  }
}

void GtkBackend::updateDesktopProps(SurfaceId, Tag, const DesktopProps &) {}

std::vector<facebook::react::ComponentDescriptorProvider> GtkBackend::componentProviders() const {
  return libraryComponents();
}

} // namespace ngn::gtk
