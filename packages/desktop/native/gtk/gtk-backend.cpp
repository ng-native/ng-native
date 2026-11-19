#include "gtk-backend.h"

#include "accessible.h"
#include "image-view.h"
#include "scroll-view.h"
#include "text-field.h"
#include "view-widget.h"

#include "ngn/library-components.h"

#include <react/renderer/components/view/ViewProps.h>

#include <utility>

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

GtkBackend::GtkBackend()
    : uiThread_(std::this_thread::get_id()),
      headers_(std::make_unique<Headers>(*this)),
      modals_(std::make_unique<Modals>(*this)) {}

GtkBackend::~GtkBackend() {
  // Each gives back the views it hosts before the views go.
  modals_.reset();
  headers_.reset();
  for (auto &[tag, entry] : searchEntries_) {
    g_object_unref(entry);
  }
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

GtkWidget *GtkBackend::surfaceWidget(SurfaceId surfaceId) const {
  auto it = surfaces_.find(surfaceId);
  return it == surfaces_.end() ? nullptr : it->second;
}

ViewData *GtkBackend::data(Tag tag) const {
  return viewData(view(tag));
}

void GtkBackend::hostView(Tag tag, GtkWidget *slot) {
  GtkWidget *widget = view(tag);
  if (!widget) {
    return;
  }
  unhostView(tag);
  GtkWidget *placeholder = makeViewWidget();
  g_object_ref_sink(placeholder);
  gtk_widget_set_child_visible(placeholder, FALSE);
  if (GtkWidget *parent = gtk_widget_get_parent(widget)) {
    gtk_widget_insert_after(placeholder, parent, widget);
    gtk_widget_unparent(widget);
  }
  gtk_widget_set_parent(widget, slot);
  hosted_[tag] = {.placeholder = placeholder, .slot = slot};
  gtk_widget_queue_resize(slot);
}

void GtkBackend::unhostView(Tag tag) {
  auto it = hosted_.find(tag);
  if (it == hosted_.end()) {
    return;
  }
  Hosted hosted = it->second;
  hosted_.erase(it);
  GtkWidget *widget = view(tag);
  if (widget && gtk_widget_get_parent(widget) == hosted.slot) {
    gtk_widget_unparent(widget);
    if (GtkWidget *parent = gtk_widget_get_parent(hosted.placeholder)) {
      gtk_widget_insert_after(widget, parent, hosted.placeholder);
    }
    relayout(widget);
  }
  if (gtk_widget_get_parent(hosted.placeholder)) {
    gtk_widget_unparent(hosted.placeholder);
  }
  g_object_unref(hosted.placeholder);
}

bool GtkBackend::isHosted(Tag tag) const {
  auto it = hosted_.find(tag);
  GtkWidget *widget = view(tag);
  return it != hosted_.end() && widget && gtk_widget_get_parent(widget) == it->second.slot;
}

GtkWidget *GtkBackend::searchEntry(Tag tag) const {
  auto it = searchEntries_.find(tag);
  return it == searchEntries_.end() ? nullptr : it->second;
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

namespace {

// react-native-svg's elements draw nothing of their own: the svg draws them. A foreignObject's
// views stay hidden with them.
void hideSvgElement(GtkWidget *widget) {
  const std::string &component = viewData(widget)->component;
  if (component.starts_with("RNSVG") && component != "RNSVGSvgView") {
    gtk_widget_set_child_visible(widget, FALSE);
  }
}

} // namespace

void GtkBackend::createView(const ShadowView &view) {
  auto accessibility = accessibilityOf(view);
  GtkWidget *widget = makeViewWidget(accessibleRole(view));
  if (accessibility) {
    applyAccessibility(widget, *accessibility);
  }
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
  } else if (d->component == "ScrollView") {
    makeScrollView(widget, *d);
    applyScrollViewState(*d);
  } else if (d->component == "Image") {
    makeImageView(widget, *d);
  } else if (d->component == "RNSScreenStackHeaderConfig") {
    // What of a header shows is in the window's header bar: its subtree is neither drawn nor hit
    // in the content.
    gtk_widget_set_child_visible(widget, FALSE);
    hooks.containerRoot(view.tag, true);
  } else if (d->component == "RNSSearchBar") {
    GtkWidget *entry = makeSearchEntry(*this, view.tag);
    searchEntries_[view.tag] = GTK_WIDGET(g_object_ref_sink(entry));
    if (view.props) {
      applySearchBar(entry, *view.props);
    }
  }
  hideSvgElement(widget);
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
  modals_->unmounted(tag);
  headers_->forget(tag);
  unhostView(tag);
  if (viewData(it->second)->component == "RNSScreenStackHeaderConfig") {
    hooks.containerRoot(tag, false);
  }
  if (auto entry = searchEntries_.find(tag); entry != searchEntries_.end()) {
    if (gtk_widget_get_parent(entry->second)) {
      gtk_widget_unparent(entry->second);
    }
    g_object_unref(entry->second);
    searchEntries_.erase(entry);
  }
  if (gtk_widget_get_parent(it->second)) {
    gtk_widget_unparent(it->second);
  }
  g_object_unref(it->second);
  views_.erase(it);
}

void GtkBackend::insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) {
  auto p = views_.find(parent), c = views_.find(child);
  if (p == views_.end() || c == views_.end()) {
    return;
  }
  unhostView(child);
  if (gtk_widget_get_parent(c->second)) {
    gtk_widget_unparent(c->second);
  }
  // Fabric's order is the drawing order. The index counts views only: a TextInput's field is a
  // child of its own, after them.
  GtkWidget *parentWidget = contentWidget(p->second);
  GtkWidget *sibling = gtk_widget_get_first_child(parentWidget);
  for (int i = 0; sibling; sibling = gtk_widget_get_next_sibling(sibling)) {
    if (!NGN_IS_VIEW(sibling) || i++ == index) {
      break;
    }
  }
  gtk_widget_insert_before(c->second, parentWidget, sibling);
  // Unparenting, here or in removeChild, made it visible again.
  hideSvgElement(c->second);
  // An Image's source was picked before it had a window, at the first monitor's scale.
  if (ViewData *d = viewData(c->second); d && d->image) {
    applyImageProps(*d, gtk_widget_get_scale_factor(c->second));
  }
  if (viewData(c->second)->component == "ModalHostView") {
    modals_->mounted(surfaceId, child);
  }
}

void GtkBackend::removeChild(SurfaceId, Tag, Tag child, int) {
  modals_->unmounted(child);
  unhostView(child);
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
  followRole(view);
  applyViewProps(it->second, *d);
  if (auto accessibility = accessibilityOf(view)) {
    applyAccessibility(it->second, *accessibility);
  }
  applyTextFieldProps(*d);
  applyScrollViewProps(*d);
  if (d->image) {
    applyImageProps(*d, gtk_widget_get_scale_factor(it->second));
  }
  if (GtkWidget *entry = searchEntry(view.tag); entry && view.props) {
    applySearchBar(entry, *view.props);
  }
  relayout(it->second);
}

void GtkBackend::updateState(const ShadowView &view) {
  if (auto it = views_.find(view.tag); it != views_.end()) {
    ViewData *d = viewData(it->second);
    d->state = view.state;
    forgetText(*d);
    applyScrollViewState(*d);
    // A Paragraph's label is its text, which is in its state, and so is whether it is static text
    // or no element at all.
    followRole(view);
    if (auto accessibility = accessibilityOf(view)) {
      applyAccessibility(it->second, *accessibility);
    }
    gtk_widget_queue_draw(it->second);
  }
}

void GtkBackend::followRole(const ShadowView &view) {
  auto it = views_.find(view.tag);
  GtkAccessibleRole role = accessibleRole(view);
  if (it == views_.end() || gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(it->second)) == role) {
    return;
  }
  GtkWidget *old = it->second;
  GtkWidget *next = makeViewWidget(role);
  g_object_ref_sink(next);
  // What the backend set on the old widget that the view's props and state do not set again below.
  gtk_widget_set_child_visible(next, gtk_widget_get_child_visible(old));
  gtk_widget_set_focusable(next, gtk_widget_get_focusable(old));
  gtk_widget_set_focus_on_click(next, gtk_widget_get_focus_on_click(old));
  gtk_widget_set_can_target(next, gtk_widget_get_can_target(old));
  if (GdkCursor *cursor = gtk_widget_get_cursor(old)) {
    gtk_widget_set_cursor(next, cursor);
  }
  // The focus, wherever in the subtree it is: moving a widget out from under its parent takes it.
  GtkRoot *root = gtk_widget_get_root(old);
  GtkWidget *focus = root ? gtk_root_get_focus(root) : nullptr;
  if (focus && focus != old && !gtk_widget_is_ancestor(focus, old)) {
    focus = nullptr;
  }
  // The view's data (its props, state, layout and text field) goes with it; the old widget keeps
  // the new one's empty data to free.
  swapViewData(old, next);
  // A state update replaces a Paragraph's widget with no props update to follow.
  applyViewProps(next, *viewData(next));
  // A focused field's GtkText loses the focus as it moves and takes it back after: the app hears
  // neither.
  TextField *field = focus ? textFieldOf(focus) : nullptr;
  ViewData *fieldView = field ? std::exchange(field->view, nullptr) : nullptr;
  // In the old one's place among its siblings, with its children in their order.
  if (GtkWidget *parent = gtk_widget_get_parent(old)) {
    gtk_widget_insert_after(next, parent, old);
    gtk_widget_unparent(old);
  }
  while (GtkWidget *child = gtk_widget_get_first_child(old)) {
    g_object_ref(child);
    // Unparenting makes a child visible again: a covered screen stays hidden.
    gboolean childVisible = gtk_widget_get_child_visible(child);
    gtk_widget_unparent(child);
    gtk_widget_insert_before(child, next, nullptr);
    gtk_widget_set_child_visible(child, childVisible);
    g_object_unref(child);
  }
  it->second = next;
  if (field && GTK_IS_TEXT(focus)) {
    // Focusing a GtkText selects all of it: the caret stays where the user left it.
    gtk_text_grab_focus_without_selecting(GTK_TEXT(focus));
  } else if (focus) {
    gtk_widget_grab_focus(focus == old ? next : focus);
  }
  if (fieldView) {
    field->view = fieldView;
  }
  g_object_unref(old);
}

void GtkBackend::updateLayout(const ShadowView &view) {
  if (auto it = views_.find(view.tag); it != views_.end()) {
    ViewData *d = viewData(it->second);
    d->layout = view.layoutMetrics;
    forgetText(*d);
    // A field's natural alignment follows the layout's direction, and a scroll view's scroll bars
    // the content's size against its own.
    applyTextFieldProps(*d);
    updateScrollers(*d);
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
    if (GtkWidget *entry = searchEntry(tag)) {
      runSearchBarCommand(entry, name, args);
    }
    scrollViewCommand(*viewData(it->second), name, args);
  }
}

void GtkBackend::setCovered(SurfaceId, Tag tag, bool covered) {
  if (auto it = views_.find(tag); it != views_.end()) {
    gtk_widget_set_child_visible(it->second, !covered);
    // A child shown again has no allocation until its parent allocates it.
    relayout(it->second);
  }
}

void GtkBackend::setFrontHeader(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) {
  headers_->show(surfaceId, header);
}

void GtkBackend::didMount(SurfaceId surfaceId) {
  modals_->settle();
  headers_->refresh();
  if (onMount) {
    onMount(surfaceId);
  }
}

void GtkBackend::updateDesktopProps(SurfaceId, Tag tag, const DesktopProps &props) {
  if (auto it = views_.find(tag); it != views_.end()) {
    ViewData *d = viewData(it->second);
    d->desktop = props;
    updateScrollers(*d);
  }
}

void GtkBackend::setSvgDrawing(SurfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) {
  if (auto it = views_.find(svg); it != views_.end() && viewData(it->second)->component == "RNSVGSvgView") {
    viewData(it->second)->svg = std::move(document);
    gtk_widget_queue_draw(it->second);
  }
}

std::vector<facebook::react::ComponentDescriptorProvider> GtkBackend::componentProviders() const {
  return libraryComponents();
}

} // namespace ngn::gtk
