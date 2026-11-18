#include "screens.h"

#include "gtk-backend.h"
#include "view-widget.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/RawEvent.h>

#include <adwaita.h>
#include <dlfcn.h>

#include <algorithm>
#include <cmath>

using namespace facebook::react;

G_BEGIN_DECLS
#define NGN_TYPE_HOST_SLOT (ngn_host_slot_get_type())
G_DECLARE_FINAL_TYPE(NgnHostSlot, ngn_host_slot, NGN, HOST_SLOT, GtkWidget)
G_END_DECLS

struct _NgnHostSlot {
  GtkWidget parent_instance;
  int width;
  int height;
};

G_DEFINE_TYPE(NgnHostSlot, ngn_host_slot, GTK_TYPE_WIDGET)

namespace {

// The size set on the slot, else its view's frame.
std::pair<int, int> slotSize(NgnHostSlot *slot) {
  if (slot->width >= 0) {
    return {slot->width, slot->height};
  }
  GtkWidget *child = gtk_widget_get_first_child(GTK_WIDGET(slot));
  auto *d = ngn::gtk::viewData(child);
  if (!d) {
    return {0, 0};
  }
  const auto &size = d->layout.frame.size;
  return {static_cast<int>(std::ceil(size.width)), static_cast<int>(std::ceil(size.height))};
}

void slotMeasure(GtkWidget *widget, GtkOrientation orientation, int, int *minimum, int *natural, int *, int *) {
  auto [w, h] = slotSize(NGN_HOST_SLOT(widget));
  *minimum = *natural = orientation == GTK_ORIENTATION_HORIZONTAL ? w : h;
}

void slotAllocate(GtkWidget *widget, int width, int height, int) {
  // The view a slot holds fills it; one replacing it (a role change) may be beside it for a moment.
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    GtkAllocation all{0, 0, width, height};
    gtk_widget_size_allocate(child, &all, -1);
  }
}

void slotDispose(GObject *object) {
  while (GtkWidget *child = gtk_widget_get_first_child(GTK_WIDGET(object))) {
    gtk_widget_unparent(child);
  }
  G_OBJECT_CLASS(ngn_host_slot_parent_class)->dispose(object);
}

const char *kChrome = "ngn-window-chrome";

// A header config's subviews still under it: those not in the header bar.
std::vector<ngn::HeaderSubview> subviewsOf(const ngn::gtk::ViewData *config) {
  std::vector<ngn::HeaderSubview> subviews;
  for (GtkWidget *c = config ? gtk_widget_get_first_child(config->widget) : nullptr; c; c = gtk_widget_get_next_sibling(c)) {
    if (const auto *d = ngn::gtk::viewData(c); d && d->props) {
      if (auto type = ngn::headerItemType(*d->props)) {
        subviews.push_back({d->tag, *type});
      }
    }
  }
  return subviews;
}

// The sheet's card and the dimmed backdrop of libadwaita 1.4's drawn sheet.
void installSheetStyle() {
  static bool installed = false;
  if (installed || !gdk_display_get_default()) {
    return;
  }
  installed = true;
  GtkCssProvider *css = gtk_css_provider_new();
  gtk_css_provider_load_from_data(
      css,
      ".ngn-backdrop { background-color: alpha(black, 0.3); }"
      ".ngn-sheet { background-color: @window_bg_color; border-radius: 12px;"
      " box-shadow: 0 2px 8px 2px alpha(black, 0.2), 0 0 0 1px alpha(black, 0.05); }",
      -1);
  gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(css);
}

template <typename Fn>
Fn adwFunction(const char *name) {
  return reinterpret_cast<Fn>(dlsym(RTLD_DEFAULT, name));
}

// Escape on `widget`, anywhere in its window, calls `fn`.
void onEscape(GtkWidget *widget, std::function<void()> fn) {
  GtkEventController *controller = gtk_shortcut_controller_new();
  gtk_shortcut_controller_set_scope(GTK_SHORTCUT_CONTROLLER(controller), GTK_SHORTCUT_SCOPE_GLOBAL);
  auto *heap = new std::function<void()>(std::move(fn));
  GtkShortcutAction *action = gtk_callback_action_new(
      [](GtkWidget *, GVariant *, gpointer data) -> gboolean {
        (*static_cast<std::function<void()> *>(data))();
        return TRUE;
      },
      heap, [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
  gtk_shortcut_controller_add_shortcut(
      GTK_SHORTCUT_CONTROLLER(controller), gtk_shortcut_new(gtk_shortcut_trigger_parse_string("Escape"), action));
  gtk_widget_add_controller(widget, controller);
}

} // namespace

static void ngn_host_slot_class_init(NgnHostSlotClass *klass) {
  GtkWidgetClass *widget = GTK_WIDGET_CLASS(klass);
  widget->measure = slotMeasure;
  widget->size_allocate = slotAllocate;
  gtk_widget_class_set_css_name(widget, "ngn-slot");
  G_OBJECT_CLASS(klass)->dispose = slotDispose;
}

static void ngn_host_slot_init(NgnHostSlot *self) {
  self->width = -1;
  self->height = -1;
}

namespace ngn::gtk {

GtkWidget *wrapInChrome(GtkWidget *surface) {
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *header = adw_header_bar_new();
  GtkWidget *overlay = gtk_overlay_new();
  gtk_overlay_set_child(GTK_OVERLAY(overlay), surface);
  gtk_widget_set_vexpand(overlay, TRUE);
  gtk_box_append(GTK_BOX(box), header);
  gtk_box_append(GTK_BOX(box), overlay);
  g_object_set_data_full(G_OBJECT(surface), kChrome, new WindowChrome{.headerBar = header, .overlay = overlay}, [](gpointer p) {
    delete static_cast<WindowChrome *>(p);
  });
  return box;
}

const WindowChrome *chromeOf(GtkWidget *surface) {
  return surface ? static_cast<const WindowChrome *>(g_object_get_data(G_OBJECT(surface), kChrome)) : nullptr;
}

GtkWidget *makeHostSlot() {
  return GTK_WIDGET(g_object_new(NGN_TYPE_HOST_SLOT, nullptr));
}

void setSlotSize(GtkWidget *slot, std::optional<std::pair<int, int>> size) {
  auto *s = NGN_HOST_SLOT(slot);
  s->width = size ? size->first : -1;
  s->height = size ? size->second : -1;
  gtk_widget_queue_resize(slot);
}

bool haveAdwDialog() {
  return g_type_from_name("AdwDialog") != 0 && adwFunction<void (*)(GtkWidget *, GtkWidget *)>("adw_dialog_present") &&
      adwFunction<void (*)(GtkWidget *)>("adw_dialog_force_close");
}

// --- Search fields ----------------------------------------------------------------------------

namespace {

// What a bar button, the back button and a dialog's close attempt reach when pressed.
using PressTarget = std::pair<GtkBackend *, std::pair<Tag, std::string>>;
using BackTarget = std::pair<GtkBackend *, Tag>;
using CloseTarget = std::pair<Modals *, Tag>;

struct SearchField {
  GtkBackend *backend;
  Tag tag;
  // A change the host made, which JavaScript already knows of.
  bool setting{false};
};

SearchField *searchFieldOf(GtkWidget *entry) {
  return static_cast<SearchField *>(g_object_get_data(G_OBJECT(entry), "ngn-search"));
}

void emitSearch(GtkWidget *entry, SearchBarInput input) {
  auto *f = searchFieldOf(entry);
  const ViewData *d = f ? f->backend->data(f->tag) : nullptr;
  if (!d || !d->emitter) {
    return;
  }
  const char *text = gtk_editable_get_text(GTK_EDITABLE(entry));
  for (auto &event : searchBarEvents(input, text ? text : "")) {
    d->emitter->dispatchEvent(event.name, std::move(event.payload), RawEvent::Category::Discrete);
  }
}

void setSearchText(GtkWidget *entry, const std::string &text) {
  auto *f = searchFieldOf(entry);
  f->setting = true;
  gtk_editable_set_text(GTK_EDITABLE(entry), text.c_str());
  f->setting = false;
}

} // namespace

GtkWidget *makeSearchEntry(GtkBackend &backend, Tag tag) {
  GtkWidget *entry = gtk_search_entry_new();
  gtk_widget_set_size_request(entry, 220, -1);
  g_object_set_data_full(G_OBJECT(entry), "ngn-search", new SearchField{&backend, tag}, [](gpointer p) {
    delete static_cast<SearchField *>(p);
  });
  g_signal_connect(entry, "search-changed", G_CALLBACK(+[](GtkSearchEntry *e, gpointer) {
    if (!searchFieldOf(GTK_WIDGET(e))->setting) {
      emitSearch(GTK_WIDGET(e), SearchBarInput::Typed);
    }
  }), nullptr);
  g_signal_connect(entry, "activate", G_CALLBACK(+[](GtkSearchEntry *e, gpointer) { emitSearch(GTK_WIDGET(e), SearchBarInput::Submitted); }), nullptr);
  // Escape is the Cancel button: the field empties first, as on iOS.
  g_signal_connect(entry, "stop-search", G_CALLBACK(+[](GtkSearchEntry *e, gpointer) {
    setSearchText(GTK_WIDGET(e), "");
    emitSearch(GTK_WIDGET(e), SearchBarInput::Cancelled);
  }), nullptr);
  GtkEventController *focus = gtk_event_controller_focus_new();
  g_signal_connect(focus, "enter", G_CALLBACK(+[](GtkEventControllerFocus *c, gpointer) {
    emitSearch(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(c)), SearchBarInput::Began);
  }), nullptr);
  g_signal_connect(focus, "leave", G_CALLBACK(+[](GtkEventControllerFocus *c, gpointer) {
    emitSearch(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(c)), SearchBarInput::Ended);
  }), nullptr);
  gtk_widget_add_controller(entry, focus);
  return entry;
}

void applySearchBar(GtkWidget *entry, const Props &props) {
  if (auto config = searchBarConfig(props)) {
    gtk_search_entry_set_placeholder_text(GTK_SEARCH_ENTRY(entry), config->placeholder.c_str());
  }
}

void runSearchBarCommand(GtkWidget *entry, const std::string &name, const folly::dynamic &args) {
  auto command = searchBarCommand(name, args);
  if (!command) {
    return;
  }
  switch (command->kind) {
    case SearchBarCommand::Focus:
      gtk_widget_grab_focus(entry);
      break;
    case SearchBarCommand::Cancel:
      setSearchText(entry, "");
      [[fallthrough]];
    case SearchBarCommand::Blur:
      if (GtkRoot *root = gtk_widget_get_root(entry); root && gtk_root_get_focus(root) &&
          (gtk_root_get_focus(root) == entry || gtk_widget_is_ancestor(gtk_root_get_focus(root), entry))) {
        gtk_root_set_focus(root, nullptr);
      }
      break;
    case SearchBarCommand::ClearText:
      setSearchText(entry, "");
      break;
    case SearchBarCommand::SetText:
      setSearchText(entry, command->text);
      break;
  }
}

// --- Headers ----------------------------------------------------------------------------------

Headers::~Headers() {
  for (auto &[surfaceId, shown] : shown_) {
    clear(surfaceId, shown);
  }
}

GtkWidget *Headers::headerBarOf(SurfaceId surfaceId) const {
  const auto *chrome = chromeOf(backend_.surfaceWidget(surfaceId));
  return chrome ? chrome->headerBar : nullptr;
}

GtkWidget *Headers::backButton(SurfaceId surfaceId) const {
  auto it = shown_.find(surfaceId);
  return it == shown_.end() ? nullptr : it->second.back;
}

void Headers::show(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) {
  auto &shown = shown_[surfaceId];
  shown.header = header;
  layOut(surfaceId, shown);
}

void Headers::refresh() {
  for (auto &[surfaceId, shown] : shown_) {
    const ViewData *config = shown.header ? backend_.data(shown.header->config) : nullptr;
    auto bar = config && config->props ? headerBar(*config->props) : std::nullopt;
    auto subviews = subviewsOf(config);
    // The hosted subviews are the config's still, unless Fabric moved them since.
    bool moved = false;
    for (Tag tag : shown.hosted) {
      if (!backend_.isHosted(tag)) {
        moved = true;
      } else if (const ViewData *d = backend_.data(tag); d && d->props) {
        subviews.push_back({tag, headerItemType(*d->props).value_or("")});
      }
    }
    auto layout = headerLayout(bar.value_or(HeaderBar{}), subviews, shown.header && shown.header->canGoBack);
    if (moved || bar != shown.bar || layout != shown.layout) {
      layOut(surfaceId, shown);
    }
  }
}

void Headers::forget(Tag tag) {
  for (auto &[surfaceId, shown] : shown_) {
    if (std::find(shown.hosted.begin(), shown.hosted.end(), tag) != shown.hosted.end()) {
      shown.hosted.erase(std::remove(shown.hosted.begin(), shown.hosted.end(), tag), shown.hosted.end());
    }
  }
}

void Headers::clear(SurfaceId surfaceId, Shown &shown) {
  GtkWidget *bar = headerBarOf(surfaceId);
  for (Tag tag : shown.hosted) {
    backend_.unhostView(tag);
    backend_.hooks.detachInput(tag);
    backend_.hooks.containerRoot(tag, false);
  }
  shown.hosted.clear();
  if (bar) {
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(bar), nullptr);
  }
  // What was packed into the bar comes out of it; the title's own children go with the title. A
  // search field is its search bar view's, which keeps it for the next header.
  for (GtkWidget *widget : shown.packed) {
    if (bar && gtk_widget_is_ancestor(widget, bar)) {
      adw_header_bar_remove(ADW_HEADER_BAR(bar), widget);
    } else if (gtk_widget_get_parent(widget)) {
      gtk_widget_unparent(widget);
    }
    g_object_unref(widget);
  }
  shown.packed.clear();
  shown.back = nullptr;
}

void Headers::layOut(SurfaceId surfaceId, Shown &shown) {
  clear(surfaceId, shown);
  GtkWidget *bar = headerBarOf(surfaceId);
  const ViewData *config = shown.header ? backend_.data(shown.header->config) : nullptr;
  shown.bar = config && config->props ? headerBar(*config->props) : std::nullopt;
  auto subviews = subviewsOf(config);
  shown.layout = headerLayout(shown.bar.value_or(HeaderBar{}), subviews, shown.header && shown.header->canGoBack);
  if (!bar || !shown.bar || shown.bar->hidden) {
    return;
  }
  const HeaderLayout &layout = shown.layout;
  auto keep = [&shown](GtkWidget *widget) {
    shown.packed.push_back(GTK_WIDGET(g_object_ref(widget)));
    return widget;
  };
  auto slotFor = [&](Tag tag) {
    GtkWidget *slot = makeHostSlot();
    backend_.hostView(tag, slot);
    backend_.hooks.containerRoot(tag, true);
    backend_.hooks.attachInput(slot, surfaceId, tag);
    shown.hosted.push_back(tag);
    return keep(slot);
  };
  auto button = [&](const BarButton &b) {
    GtkWidget *widget = b.spacing ? gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0) : gtk_button_new_with_label(b.title.c_str());
    if (b.spacing) {
      gtk_widget_set_size_request(widget, static_cast<int>(*b.spacing), -1);
      return keep(widget);
    }
    gtk_widget_set_sensitive(widget, !b.disabled);
    if (!b.accessibilityLabel.empty()) {
      gtk_accessible_update_property(GTK_ACCESSIBLE(widget), GTK_ACCESSIBLE_PROPERTY_LABEL, b.accessibilityLabel.c_str(), -1);
    }
    Tag configTag = shown.header->config;
    auto *pressed = new PressTarget(&backend_, {configTag, b.id});
    g_signal_connect_data(widget, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
      auto *p = static_cast<PressTarget *>(data);
      if (const ViewData *d = p->first->data(p->second.first); d && d->emitter) {
        d->emitter->dispatchEvent("pressHeaderBarButtonItem", folly::dynamic::object("buttonId", p->second.second));
      }
    }), pressed, [](gpointer data, GClosure *) { delete static_cast<PressTarget *>(data); }, GConnectFlags(0));
    return keep(widget);
  };

  if (layout.back) {
    GtkWidget *back = keep(gtk_button_new_from_icon_name("go-previous-symbolic"));
    gtk_widget_set_tooltip_text(back, "Back");
    gtk_accessible_update_property(GTK_ACCESSIBLE(back), GTK_ACCESSIBLE_PROPERTY_LABEL, "Back", -1);
    auto *where = new BackTarget(&backend_, shown.header->screen);
    g_signal_connect_data(back, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
      auto *p = static_cast<BackTarget *>(data);
      if (const ViewData *d = p->first->data(p->second); d && d->emitter) {
        d->emitter->dispatchEvent("headerBackButtonClicked");
      }
    }), where, [](gpointer data, GClosure *) { delete static_cast<BackTarget *>(data); }, GConnectFlags(0));
    adw_header_bar_pack_start(ADW_HEADER_BAR(bar), back);
    shown.back = back;
  }
  for (Tag tag : layout.left) {
    adw_header_bar_pack_start(ADW_HEADER_BAR(bar), slotFor(tag));
  }
  for (const auto &b : shown.bar->left) {
    adw_header_bar_pack_start(ADW_HEADER_BAR(bar), button(b));
  }
  if (!layout.center.empty()) {
    GtkWidget *center = keep(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6));
    for (Tag tag : layout.center) {
      gtk_box_append(GTK_BOX(center), slotFor(tag));
    }
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(bar), center);
  } else {
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(bar), keep(adw_window_title_new(shown.bar->title.c_str(), "")));
  }
  // The end packs from the window's edge inward: the last piece in reading order first.
  for (Tag tag : layout.searchBars) {
    const ViewData *subview = backend_.data(tag);
    for (GtkWidget *c = subview ? gtk_widget_get_first_child(subview->widget) : nullptr; c; c = gtk_widget_get_next_sibling(c)) {
      if (const ViewData *d = viewData(c); d && d->component == "RNSSearchBar") {
        if (GtkWidget *entry = backend_.searchEntry(d->tag)) {
          adw_header_bar_pack_end(ADW_HEADER_BAR(bar), keep(entry));
        }
      }
    }
  }
  for (auto it = layout.right.rbegin(); it != layout.right.rend(); ++it) {
    adw_header_bar_pack_end(ADW_HEADER_BAR(bar), slotFor(*it));
  }
  for (auto it = shown.bar->right.rbegin(); it != shown.bar->right.rend(); ++it) {
    adw_header_bar_pack_end(ADW_HEADER_BAR(bar), button(*it));
  }
}

// --- Modals -----------------------------------------------------------------------------------

Modals::~Modals() {
  while (!presented_.empty()) {
    dismiss(presented_.begin()->first);
  }
}

void Modals::mounted(SurfaceId surfaceId, Tag tag) {
  if (!presented_.count(tag)) {
    pending_.insert({surfaceId, tag});
  }
}

void Modals::unmounted(Tag tag) {
  for (auto it = pending_.begin(); it != pending_.end();) {
    it = it->second == tag ? pending_.erase(it) : std::next(it);
  }
  dismiss(tag);
}

void Modals::settle() {
  auto pending = std::move(pending_);
  pending_.clear();
  for (auto [surfaceId, tag] : pending) {
    present(surfaceId, tag);
  }
  for (auto &[tag, presented] : presented_) {
    fit(tag, presented);
  }
}

GtkWidget *Modals::slotOf(Tag tag) const {
  auto it = presented_.find(tag);
  return it == presented_.end() ? nullptr : it->second.slot;
}

bool Modals::inDialog(Tag tag) const {
  auto it = presented_.find(tag);
  return it != presented_.end() && it->second.dialog != nullptr;
}

void Modals::requestClose(Tag tag) {
  if (const ViewData *d = backend_.data(tag)) {
    if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(d->emitter)) {
      emitter->onRequestClose({});
    }
  }
}

void Modals::present(SurfaceId surfaceId, Tag tag) {
  const ViewData *d = backend_.data(tag);
  GtkWidget *surface = backend_.surfaceWidget(surfaceId);
  const WindowChrome *chrome = chromeOf(surface);
  if (!d || !chrome || presented_.count(tag)) {
    return;
  }
  installSheetStyle();
  Presented p{.surfaceId = surfaceId, .presentation = d->desktop.presentation};
  // A popover is a sheet until the GTK host has popovers.
  bool sheet = p.presentation != ModalPresentation::Cover;
  GtkRoot *root = gtk_widget_get_root(surface);
  if (GtkWidget *focus = root ? gtk_root_get_focus(root) : nullptr) {
    p.opener = GTK_WIDGET(g_object_ref(focus));
  }
  p.slot = GTK_WIDGET(g_object_ref_sink(makeHostSlot()));
  backend_.hostView(tag, p.slot);
  if (sheet && haveAdwDialog()) {
    // AdwDialog by its type and properties, which 1.4's headers do not declare. It asks before it
    // closes, and the app decides, as Escape on macOS asks.
    GtkWidget *dialog = GTK_WIDGET(g_object_new(g_type_from_name("AdwDialog"), "can-close", FALSE, "child", p.slot, nullptr));
    // Floating, never libadwaita's bottom sheet.
    if (g_object_class_find_property(G_OBJECT_GET_CLASS(dialog), "presentation-mode")) {
      g_object_set(dialog, "presentation-mode", 1, nullptr);
    }
    g_signal_connect_data(
        dialog, "close-attempt", G_CALLBACK(+[](GtkWidget *, gpointer data) {
          auto *self = static_cast<CloseTarget *>(data);
          self->first->requestClose(self->second);
        }),
        new CloseTarget(this, tag), [](gpointer data, GClosure *) { delete static_cast<CloseTarget *>(data); },
        GConnectFlags(0));
    p.dialog = GTK_WIDGET(g_object_ref(dialog));
  } else if (sheet) {
    GtkWidget *backdrop = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_add_css_class(backdrop, "ngn-backdrop");
    gtk_widget_set_halign(p.slot, GTK_ALIGN_CENTER);
    gtk_widget_set_valign(p.slot, GTK_ALIGN_CENTER);
    gtk_widget_set_vexpand(p.slot, TRUE);
    gtk_widget_add_css_class(p.slot, "ngn-sheet");
    gtk_widget_set_overflow(p.slot, GTK_OVERFLOW_HIDDEN);
    gtk_box_append(GTK_BOX(backdrop), p.slot);
    p.layer = backdrop;
  } else {
    p.layer = p.slot;
  }
  if (p.layer) {
    onEscape(p.layer, [this, tag] { requestClose(tag); });
    gtk_overlay_add_overlay(GTK_OVERLAY(chrome->overlay), p.layer);
  }
  backend_.hooks.containerRoot(tag, true);
  backend_.hooks.attachInput(p.slot, surfaceId, tag);
  auto &presented = presented_[tag] = p;
  fit(tag, presented);
  if (presented.dialog) {
    adwFunction<void (*)(GtkWidget *, GtkWidget *)>("adw_dialog_present")(presented.dialog, surface);
  }
  gtk_widget_child_focus(presented.slot, GTK_DIR_TAB_FORWARD);
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(d->emitter)) {
    emitter->onShow({});
  }
}

void Modals::fit(Tag tag, Presented &p) {
  GtkWidget *surface = backend_.surfaceWidget(p.surfaceId);
  const ViewData *d = backend_.data(tag);
  if (!surface || !d) {
    return;
  }
  Size window{static_cast<Float>(gtk_widget_get_width(surface)), static_cast<Float>(gtk_widget_get_height(surface))};
  Size size = window;
  if (p.presentation != ModalPresentation::Cover) {
    auto node = sheetNodes_ ? sheetNodes_(p.surfaceId, tag) : std::nullopt;
    size = sheetSize(node.value_or(SheetNode{}), window);
  }
  std::pair<int, int> pixels{static_cast<int>(std::lround(size.width)), static_cast<int>(std::lround(size.height))};
  if (pixels == p.size) {
    return;
  }
  p.size = pixels;
  if (p.presentation == ModalPresentation::Cover) {
    // A cover fills the overlay, whatever its size.
    setSlotSize(p.slot, std::nullopt);
  } else {
    setSlotSize(p.slot, pixels);
  }
  if (p.dialog) {
    g_object_set(p.dialog, "content-width", pixels.first, "content-height", pixels.second, nullptr);
  }
  if (auto state = std::dynamic_pointer_cast<const ConcreteState<ModalHostViewState>>(d->state)) {
    state->updateState(ModalHostViewState(size));
  }
}

void Modals::dismiss(Tag tag) {
  auto it = presented_.find(tag);
  if (it == presented_.end()) {
    return;
  }
  Presented p = it->second;
  presented_.erase(it);
  backend_.unhostView(tag);
  backend_.hooks.detachInput(tag);
  backend_.hooks.containerRoot(tag, false);
  if (p.dialog) {
    adwFunction<void (*)(GtkWidget *)>("adw_dialog_force_close")(p.dialog);
    g_object_unref(p.dialog);
  }
  if (p.layer) {
    if (const WindowChrome *chrome = chromeOf(backend_.surfaceWidget(p.surfaceId)); chrome && gtk_widget_get_parent(p.layer)) {
      gtk_overlay_remove_overlay(GTK_OVERLAY(chrome->overlay), p.layer);
    }
  }
  g_object_unref(p.slot);
  if (p.opener) {
    if (gtk_widget_get_root(p.opener)) {
      gtk_widget_grab_focus(p.opener);
    }
    g_object_unref(p.opener);
  }
}

} // namespace ngn::gtk
