#include "screens.h"

#include "gtk-backend.h"
#include "menus.h"
#include "view-widget.h"

#include "ngn/screen-presentation.h"
#include "ngn/split-view.h"

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/RawEvent.h>

#include <adwaita.h>
#include <dlfcn.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <set>

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

} // namespace

namespace ngn::gtk {

std::string colorRule(const char *name, const char *property, float red, float green, float blue, float alpha) {
  auto byte = [](float v) { return static_cast<unsigned>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255)); };
  // CSS wants a point, whatever the user's locale writes a decimal as.
  char opacity[G_ASCII_DTOSTR_BUF_SIZE];
  g_ascii_formatd(opacity, sizeof opacity, "%.3f", static_cast<double>(alpha));
  char rule[200];
  std::snprintf(rule, sizeof rule, ".%s { %s: rgba(%u, %u, %u, %s); }", name, property, byte(red), byte(green), byte(blue), opacity);
  return rule;
}

std::string colorClass(const char *property, const SharedColor &color) {
  if (!color || !gdk_display_get_default()) {
    return {};
  }
  auto c = colorComponentsFromColor(color);
  auto byte = [](float v) { return static_cast<unsigned>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255)); };
  char name[48];
  std::snprintf(
      name, sizeof name, "ngn-%s-%02x%02x%02x%02x", std::string_view(property) == "color" ? "fg" : "bg", byte(c.red),
      byte(c.green), byte(c.blue), byte(c.alpha));
  static std::set<std::string> added;
  if (added.insert(name).second) {
    std::string rule = colorRule(name, property, c.red, c.green, c.blue, c.alpha);
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, rule.c_str(), -1);
    gtk_style_context_add_provider_for_display(
        gdk_display_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
  }
  return name;
}

} // namespace ngn::gtk

namespace {

void addClass(GtkWidget *widget, const std::string &name) {
  if (!name.empty()) {
    gtk_widget_add_css_class(widget, name.c_str());
  }
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

GtkWidget *wrapInChrome(GtkWidget *surface, const ChromeOptions &options) {
  GtkWidget *toolbar = adw_toolbar_view_new();
  GtkWidget *header = adw_header_bar_new();
  GtkWidget *overlay = gtk_overlay_new();
  gtk_overlay_set_child(GTK_OVERLAY(overlay), surface);
  adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(toolbar), header);
  adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(toolbar), overlay);
  auto *chrome = new WindowChrome{.toolbarView = toolbar, .headerBar = header, .overlay = overlay, .titleBar = options.titleBar};
  if (options.menus == MenuPlacement::MenuBar) {
    chrome->menuBar = gtk_popover_menu_bar_new_from_model(nullptr);
    gtk_widget_set_visible(chrome->menuBar, FALSE);
    adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(toolbar), chrome->menuBar);
  } else {
    chrome->primaryMenu = gtk_menu_button_new();
    gtk_menu_button_set_icon_name(GTK_MENU_BUTTON(chrome->primaryMenu), "open-menu-symbolic");
    gtk_menu_button_set_primary(GTK_MENU_BUTTON(chrome->primaryMenu), TRUE);
    gtk_widget_set_tooltip_text(chrome->primaryMenu, "Main Menu");
    gtk_widget_set_visible(chrome->primaryMenu, FALSE);
    adw_header_bar_pack_end(ADW_HEADER_BAR(header), chrome->primaryMenu);
  }
  if (runsUnderHeaderBar(*chrome)) {
    // A flat bar over the content, which shows through it.
    adw_toolbar_view_set_top_bar_style(ADW_TOOLBAR_VIEW(toolbar), ADW_TOOLBAR_FLAT);
    adw_toolbar_view_set_extend_content_to_top_edge(ADW_TOOLBAR_VIEW(toolbar), TRUE);
    adw_header_bar_set_show_title(ADW_HEADER_BAR(header), options.titleBar != TitleBar::Hidden);
  } else {
    // The bar above the content, with its edge, as the content scrolls under nothing.
    adw_toolbar_view_set_top_bar_style(ADW_TOOLBAR_VIEW(toolbar), ADW_TOOLBAR_RAISED);
  }
  g_object_set_data_full(G_OBJECT(surface), kChrome, chrome, [](gpointer p) { delete static_cast<WindowChrome *>(p); });
  return toolbar;
}

const WindowChrome *chromeOf(GtkWidget *surface) {
  return surface ? static_cast<const WindowChrome *>(g_object_get_data(G_OBJECT(surface), kChrome)) : nullptr;
}

bool runsUnderHeaderBar(const WindowChrome &chrome) {
  return chrome.titleBar != TitleBar::Default;
}

namespace {

// The window controls in `widget`'s subtree that show a button: the start side's and the end's,
// as gtk-decoration-layout splits them at its colon.
void findWindowControls(GtkWidget *widget, std::vector<GtkWidget *> &found) {
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (GTK_IS_WINDOW_CONTROLS(child)) {
      if (!gtk_window_controls_get_empty(GTK_WINDOW_CONTROLS(child)) && gtk_widget_get_visible(child)) {
        found.push_back(child);
      }
    } else {
      findWindowControls(child, found);
    }
  }
}

} // namespace

ContainerInsets chromeInsets(GtkWidget *surface) {
  ContainerInsets insets{.size = {static_cast<Float>(gtk_widget_get_width(surface)), static_cast<Float>(gtk_widget_get_height(surface))}};
  const WindowChrome *chrome = chromeOf(surface);
  if (!chrome || !runsUnderHeaderBar(*chrome)) {
    return insets;
  }
  insets.insets.top = static_cast<Float>(adw_toolbar_view_get_top_bar_height(ADW_TOOLBAR_VIEW(chrome->toolbarView)));
  bool rightToLeft = gtk_widget_get_direction(surface) == GTK_TEXT_DIR_RTL;
  std::vector<GtkWidget *> controls;
  findWindowControls(chrome->headerBar, controls);
  for (GtkWidget *side : controls) {
    graphene_rect_t bounds;
    if (!gtk_widget_compute_bounds(side, surface, &bounds)) {
      continue;
    }
    double minX = bounds.origin.x, maxX = bounds.origin.x + bounds.size.width;
    if (gtk_window_controls_get_side(GTK_WINDOW_CONTROLS(side)) == GTK_PACK_START) {
      insets.titlebarLeading = std::max(insets.titlebarLeading, titlebarLeading(minX, maxX, insets.size.width, rightToLeft));
    } else {
      insets.titlebarTrailing = std::max(insets.titlebarTrailing, titlebarTrailing(minX, maxX, insets.size.width, rightToLeft));
    }
  }
  return insets;
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
struct ChevronTarget {
  Headers *headers;
  SurfaceId surfaceId;
  NavigationDirection direction;
};
using CloseTarget = std::pair<Modals *, Tag>;

// The menu entries of a bar button's menu, as a GMenu whose actions are `group`'s: choosing one
// sends its menu id, as AppKit's menu does. An `on` entry is a stateful action, which GTK draws
// with a check.
void fillMenu(
    GMenu *menu, const HeaderMenuItem &entry, GSimpleActionGroup *group, int &next, GtkBackend &backend, Tag config,
    bool disabled = false) {
  for (const auto &child : entry.items) {
    if (child.inlineSection) {
      GMenu *section = g_menu_new();
      for (const auto &inner : child.items) {
        HeaderMenuItem one;
        one.items.push_back(inner);
        fillMenu(section, one, group, next, backend, config, disabled);
      }
      g_menu_append_section(menu, nullptr, G_MENU_MODEL(section));
      g_object_unref(section);
    } else if (!child.items.empty() || child.menuId.empty()) {
      GMenu *submenu = g_menu_new();
      // A disabled submenu has no entry that can be chosen.
      fillMenu(submenu, child, group, next, backend, config, disabled || child.disabled);
      g_menu_append_submenu(menu, child.title.c_str(), G_MENU_MODEL(submenu));
      g_object_unref(submenu);
    } else {
      std::string name = "item" + std::to_string(next++);
      GSimpleAction *action = child.on ? g_simple_action_new_stateful(name.c_str(), nullptr, g_variant_new_boolean(TRUE))
                                       : g_simple_action_new(name.c_str(), nullptr);
      g_simple_action_set_enabled(action, !disabled && !child.disabled);
      g_signal_connect_data(
          action, "activate", G_CALLBACK(+[](GSimpleAction *, GVariant *, gpointer data) {
            auto *p = static_cast<PressTarget *>(data);
            if (const ViewData *d = p->first->data(p->second.first); d && d->emitter) {
              d->emitter->dispatchEvent(
                  "pressHeaderBarButtonMenuItem", folly::dynamic::object("menuId", p->second.second),
                  RawEvent::Category::Discrete);
            }
          }),
          new PressTarget(&backend, {config, child.menuId}),
          [](gpointer data, GClosure *) { delete static_cast<PressTarget *>(data); }, GConnectFlags(0));
      g_action_map_add_action(G_ACTION_MAP(group), G_ACTION(action));
      g_object_unref(action);
      g_menu_append(menu, child.title.c_str(), ("ngn." + name).c_str());
    }
  }
}

// A bar button with a menu: a GtkMenuButton opening it.
GtkWidget *menuButton(GtkBackend &backend, Tag config, const BarButton &button) {
  GtkWidget *widget = gtk_menu_button_new();
  gtk_menu_button_set_label(GTK_MENU_BUTTON(widget), (button.title.empty() ? button.accessibilityLabel : button.title).c_str());
  GMenu *menu = g_menu_new();
  GSimpleActionGroup *group = g_simple_action_group_new();
  int next = 0;
  fillMenu(menu, *button.menu, group, next, backend, config);
  // Nested, as the window's menus are, so two submenus with one title each open their own.
  gtk_menu_button_set_popover(GTK_MENU_BUTTON(widget), nestedPopoverMenu(G_MENU_MODEL(menu)));
  gtk_widget_insert_action_group(widget, "ngn", G_ACTION_GROUP(group));
  // GTK 4.10 cannot read an inserted group back; tests read it here.
  g_object_set_data_full(G_OBJECT(widget), "ngn-menu-actions", g_object_ref(group), g_object_unref);
  g_object_unref(menu);
  g_object_unref(group);
  return widget;
}

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
  // Each change as it happens: `search-changed` comes after a delay, when a change the host made
  // can no longer be told from the user's.
  g_signal_connect(entry, "changed", G_CALLBACK(+[](GtkEditable *e, gpointer) {
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

GtkWidget *Headers::forwardButton(SurfaceId surfaceId) const {
  auto it = shown_.find(surfaceId);
  return it == shown_.end() ? nullptr : it->second.forward;
}

void Headers::setHistory(SurfaceId surfaceId, const std::optional<WindowHistory> &history) {
  auto &shown = shown_[surfaceId];
  if (shown.history == history) {
    return;
  }
  shown.history = history;
  layOut(surfaceId, shown);
}

void Headers::pressChevron(SurfaceId surfaceId, NavigationDirection direction) {
  auto it = shown_.find(surfaceId);
  if (it == shown_.end()) {
    return;
  }
  const Shown &shown = it->second;
  if (shown.buttons.fromHistory) {
    if (navigate) {
      navigate(surfaceId, direction, 1);
    }
  } else if (direction == NavigationDirection::Back && shown.header) {
    if (const ViewData *d = backend_.data(shown.header->screen); d && d->emitter) {
      d->emitter->dispatchEvent("headerBackButtonClicked");
    }
  }
}

bool Headers::showHistoryMenu(SurfaceId surfaceId, NavigationDirection direction) {
  auto it = shown_.find(surfaceId);
  if (it == shown_.end() || !it->second.history || !it->second.buttons.fromHistory) {
    return false;
  }
  GtkWidget *chevron = direction == NavigationDirection::Back ? it->second.back : it->second.forward;
  if (!chevron || !gtk_widget_get_sensitive(chevron)) {
    return false;
  }
  std::vector<MenuItem> items;
  for (const auto &entry : historyMenu(*it->second.history, direction)) {
    items.push_back({
        .title = entry.title,
        .command = direction == NavigationDirection::Back ? MenuCommand::Back : MenuCommand::Forward,
        .id = std::to_string(entry.steps),
    });
  }
  // Under the chevron, where a menu button's list opens.
  Point at{0, static_cast<Float>(gtk_widget_get_height(chevron))};
  return popUpContextMenu(chevron, at, items, [this, surfaceId, direction](const MenuItem &item) {
    if (navigate) {
      navigate(surfaceId, direction, std::stoi(item.id));
    }
  });
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

void Headers::refreshChrome(SurfaceId surfaceId) {
  layOut(surfaceId, shown_[surfaceId]);
}

void Headers::toggleSidebar(SurfaceId surfaceId) {
  backend_.splitViews().toggle(surfaceId);
}

GtkWidget *Headers::sidebarButton(SurfaceId surfaceId) const {
  auto it = shown_.find(surfaceId);
  return it == shown_.end() ? nullptr : it->second.sidebarButton;
}

void Headers::removeSurface(SurfaceId surfaceId) {
  if (auto it = shown_.find(surfaceId); it != shown_.end()) {
    clear(surfaceId, it->second);
    shown_.erase(it);
  }
}

void Headers::forget(Tag tag) {
  for (auto &[surfaceId, shown] : shown_) {
    if (auto it = std::find(shown.hosted.begin(), shown.hosted.end(), tag); it != shown.hosted.end()) {
      // Let go of as clear() lets go of it, which will no longer see it.
      backend_.unhostView(tag);
      backend_.hooks.detachInput(tag);
      backend_.hooks.containerRoot(tag, false);
      shown.hosted.erase(it);
    }
  }
}

namespace {

// Takes a widget packed into the header bar back out, and lets it go.
void unpack(GtkWidget *bar, GtkWidget *widget) {
  if (bar && gtk_widget_is_ancestor(widget, bar)) {
    adw_header_bar_remove(ADW_HEADER_BAR(bar), widget);
  } else if (gtk_widget_get_parent(widget)) {
    gtk_widget_unparent(widget);
  }
  g_object_unref(widget);
}

} // namespace

void Headers::clear(SurfaceId surfaceId, Shown &shown, bool keepSearches) {
  GtkWidget *bar = headerBarOf(surfaceId);
  if (!keepSearches) {
    for (GtkWidget *entry : shown.searches) {
      unpack(bar, entry);
    }
    shown.searches.clear();
  }
  for (Tag tag : shown.hosted) {
    backend_.unhostView(tag);
    backend_.hooks.detachInput(tag);
    backend_.hooks.containerRoot(tag, false);
  }
  shown.hosted.clear();
  if (bar) {
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(bar), nullptr);
  }
  // A chevron's list still open goes before the chevron does.
  for (GtkWidget *chevron : {shown.back, shown.forward}) {
    for (GtkWidget *c = chevron ? gtk_widget_get_first_child(chevron) : nullptr; c;) {
      GtkWidget *next = gtk_widget_get_next_sibling(c);
      if (GTK_IS_POPOVER(c)) {
        gtk_widget_unparent(c);
      }
      c = next;
    }
  }
  // What was packed into the bar comes out of it; the title's own children go with the title. A
  // search field is its search bar view's, which keeps it for the next header.
  for (GtkWidget *widget : shown.packed) {
    unpack(bar, widget);
  }
  shown.packed.clear();
  shown.back = nullptr;
  shown.forward = nullptr;
  shown.sidebarButton = nullptr;
  shown.buttons = {};
  if (bar && !shown.background.empty()) {
    gtk_widget_remove_css_class(bar, shown.background.c_str());
  }
  shown.background.clear();
}

void Headers::layOut(SurfaceId surfaceId, Shown &shown) {
  // The search fields stay packed when they stay the same: one taken out loses the focus, and
  // typing into it stops.
  clear(surfaceId, shown, true);
  GtkWidget *bar = headerBarOf(surfaceId);
  const ViewData *config = shown.header ? backend_.data(shown.header->config) : nullptr;
  shown.bar = config && config->props ? headerBar(*config->props) : std::nullopt;
  auto subviews = subviewsOf(config);
  shown.layout = headerLayout(shown.bar.value_or(HeaderBar{}), subviews, shown.header && shown.header->canGoBack);
  // A window with a split view of its own keeps its sidebar button, and the pair, with no header
  // in front, as the macOS toolbar does.
  bool header = shown.bar && !shown.bar->hidden;
  bool sidebar = backend_.splitViews().windowSplit(surfaceId).has_value();
  bool showing = bar && header;
  std::vector<GtkWidget *> searches;
  for (Tag tag : showing ? shown.layout.searchBars : std::vector<Tag>{}) {
    const ViewData *subview = backend_.data(tag);
    for (GtkWidget *c = subview ? gtk_widget_get_first_child(subview->widget) : nullptr; c; c = gtk_widget_get_next_sibling(c)) {
      if (const ViewData *d = viewData(c); d && d->component == "RNSSearchBar") {
        if (GtkWidget *entry = backend_.searchEntry(d->tag)) {
          searches.push_back(entry);
        }
      }
    }
  }
  if (searches != shown.searches) {
    clear(surfaceId, shown);
    // The end packs from the window's edge inward: the search fields are outermost.
    for (GtkWidget *entry : searches) {
      adw_header_bar_pack_end(ADW_HEADER_BAR(bar), entry);
      shown.searches.push_back(GTK_WIDGET(g_object_ref(entry)));
    }
  }
  if (!bar || (!header && !sidebar)) {
    return;
  }
  const HeaderLayout &layout = shown.layout;
  auto keep = [&shown](GtkWidget *widget) {
    shown.packed.push_back(GTK_WIDGET(g_object_ref(widget)));
    return widget;
  };
  if (sidebar) {
    GtkWidget *toggle = keep(gtk_button_new_from_icon_name("sidebar-show-symbolic"));
    gtk_widget_set_tooltip_text(toggle, "Show Sidebar");
    gtk_accessible_update_property(GTK_ACCESSIBLE(toggle), GTK_ACCESSIBLE_PROPERTY_LABEL, "Show Sidebar", -1);
    auto *where = new ChevronTarget{this, surfaceId, NavigationDirection::Back};
    g_signal_connect_data(toggle, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
      auto *t = static_cast<ChevronTarget *>(data);
      t->headers->toggleSidebar(t->surfaceId);
    }), where, [](gpointer data, GClosure *) { delete static_cast<ChevronTarget *>(data); }, GConnectFlags(0));
    adw_header_bar_pack_start(ADW_HEADER_BAR(bar), toggle);
    shown.sidebarButton = toggle;
  }
  auto slotFor = [&](Tag tag) {
    GtkWidget *slot = makeHostSlot();
    // Centred in the bar's height, as a toolbar item is.
    gtk_widget_set_valign(slot, GTK_ALIGN_CENTER);
    backend_.hostView(tag, slot);
    backend_.hooks.containerRoot(tag, true);
    backend_.hooks.attachInput(slot, surfaceId, tag);
    shown.hosted.push_back(tag);
    return keep(slot);
  };
  // The header's tint on its buttons, the back button's included, unless a button has its own; its
  // title colour on the title; its background colour on the bar.
  std::string tint = header ? colorClass("color", shown.bar->color) : std::string();
  if (header) {
    shown.background = colorClass("background-color", shown.bar->backgroundColor);
    addClass(bar, shown.background);
  }
  auto button = [&](const BarButton &b) {
    if (b.spacing) {
      GtkWidget *widget = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
      gtk_widget_set_size_request(widget, static_cast<int>(*b.spacing), -1);
      return keep(widget);
    }
    GtkWidget *widget = b.menu ? menuButton(backend_, shown.header->config, b) : gtk_button_new_with_label(b.title.c_str());
    addClass(widget, b.tint ? colorClass("color", b.tint) : tint);
    if (b.menu) {
      gtk_widget_set_sensitive(widget, !b.disabled);
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

  // The pair leads the bar while the window has history, or, for an app that reports none, while
  // the stack can go back; the header's hideBackButton and its own left items replace it. The
  // layout is asked as though the screen could go back, so the history has its say as well.
  // With no header, only the history has its say.
  bool backAllowed = header && headerLayout(*shown.bar, subviews, true).back;
  shown.buttons = header ? historyButtons(shown.history, shown.header && shown.header->canGoBack, !backAllowed)
                         : historyButtons(shown.history, false, false);
  if (shown.buttons.shown) {
    GtkWidget *pair = keep(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0));
    gtk_widget_add_css_class(pair, "linked");
    auto chevron = [&](NavigationDirection direction) {
      bool back = direction == NavigationDirection::Back;
      GtkWidget *button = gtk_button_new_from_icon_name(back ? "go-previous-symbolic" : "go-next-symbolic");
      addClass(button, tint);
      gtk_widget_set_tooltip_text(button, back ? "Back" : "Forward");
      gtk_accessible_update_property(GTK_ACCESSIBLE(button), GTK_ACCESSIBLE_PROPERTY_LABEL, back ? "Back" : "Forward", -1);
      gtk_widget_set_sensitive(button, back ? shown.buttons.backEnabled : shown.buttons.forwardEnabled);
      ChevronTarget target{this, surfaceId, direction};
      g_signal_connect_data(button, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
        auto *t = static_cast<ChevronTarget *>(data);
        t->headers->pressChevron(t->surfaceId, t->direction);
      }), new ChevronTarget(target), [](gpointer data, GClosure *) { delete static_cast<ChevronTarget *>(data); }, GConnectFlags(0));
      // A secondary click or a long press lists the entries that way, as AppKit's segments do.
      GtkGesture *secondary = gtk_gesture_click_new();
      gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(secondary), GDK_BUTTON_SECONDARY);
      g_signal_connect_data(secondary, "pressed", G_CALLBACK(+[](GtkGestureClick *g, int, double, double, gpointer data) {
        auto *t = static_cast<ChevronTarget *>(data);
        if (t->headers->showHistoryMenu(t->surfaceId, t->direction)) {
          gtk_gesture_set_state(GTK_GESTURE(g), GTK_EVENT_SEQUENCE_CLAIMED);
        }
      }), new ChevronTarget(target), [](gpointer data, GClosure *) { delete static_cast<ChevronTarget *>(data); }, GConnectFlags(0));
      gtk_widget_add_controller(button, GTK_EVENT_CONTROLLER(secondary));
      GtkGesture *hold = gtk_gesture_long_press_new();
      g_signal_connect_data(hold, "pressed", G_CALLBACK(+[](GtkGestureLongPress *g, double, double, gpointer data) {
        auto *t = static_cast<ChevronTarget *>(data);
        if (t->headers->showHistoryMenu(t->surfaceId, t->direction)) {
          gtk_gesture_set_state(GTK_GESTURE(g), GTK_EVENT_SEQUENCE_CLAIMED);
        }
      }), new ChevronTarget(target), [](gpointer data, GClosure *) { delete static_cast<ChevronTarget *>(data); }, GConnectFlags(0));
      gtk_widget_add_controller(button, GTK_EVENT_CONTROLLER(hold));
      gtk_box_append(GTK_BOX(pair), button);
      return button;
    };
    shown.back = chevron(NavigationDirection::Back);
    shown.forward = chevron(NavigationDirection::Forward);
    adw_header_bar_pack_start(ADW_HEADER_BAR(bar), pair);
  }
  if (!header) {
    return;
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
    GtkWidget *title = keep(adw_window_title_new(shown.bar->title.c_str(), ""));
    addClass(title, colorClass("color", shown.bar->titleColor));
    adw_header_bar_set_title_widget(ADW_HEADER_BAR(bar), title);
  }
  // Inward of the search fields, the last piece in reading order first.
  for (auto it = layout.right.rbegin(); it != layout.right.rend(); ++it) {
    adw_header_bar_pack_end(ADW_HEADER_BAR(bar), slotFor(*it));
  }
  for (auto it = shown.bar->right.rbegin(); it != shown.bar->right.rend(); ++it) {
    adw_header_bar_pack_end(ADW_HEADER_BAR(bar), button(*it));
  }
}

// --- Modals -----------------------------------------------------------------------------------

namespace {

// The header config under a presented screen, whose header the sheet draws.
const ViewData *headerConfigOf(const GtkBackend &backend, Tag screen) {
  const ViewData *d = backend.data(screen);
  for (GtkWidget *c = d ? gtk_widget_get_first_child(d->widget) : nullptr; c; c = gtk_widget_get_next_sibling(c)) {
    if (const ViewData *child = viewData(c); child && child->component == "RNSScreenStackHeaderConfig") {
      return child;
    }
  }
  return nullptr;
}

// A shortcut on `widget`, anywhere in its window: `fn` says whether it acted.
void onKey(GtkWidget *widget, const char *keys, std::function<bool()> fn) {
  GtkEventController *controller = gtk_shortcut_controller_new();
  gtk_shortcut_controller_set_scope(GTK_SHORTCUT_CONTROLLER(controller), GTK_SHORTCUT_SCOPE_GLOBAL);
  auto *heap = new std::function<bool()>(std::move(fn));
  GtkShortcutAction *action = gtk_callback_action_new(
      [](GtkWidget *, GVariant *, gpointer data) -> gboolean { return (*static_cast<std::function<bool()> *>(data))(); },
      heap, [](gpointer data) { delete static_cast<std::function<bool()> *>(data); });
  gtk_shortcut_controller_add_shortcut(
      GTK_SHORTCUT_CONTROLLER(controller), gtk_shortcut_new(gtk_shortcut_trigger_parse_string(keys), action));
  gtk_widget_add_controller(widget, controller);
}

int naturalHeight(GtkWidget *widget) {
  int minimum = 0, natural = 0;
  gtk_widget_measure(widget, GTK_ORIENTATION_VERTICAL, -1, &minimum, &natural, nullptr, nullptr);
  return natural;
}

} // namespace

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

void Modals::setPresented(SurfaceId surfaceId, Tag screen, bool presented) {
  if (presented) {
    mounted(surfaceId, screen);
  } else {
    unmounted(screen);
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
    dress(tag, presented);
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

GtkWidget *Modals::popoverOf(Tag tag) const {
  auto it = presented_.find(tag);
  return it == presented_.end() ? nullptr : it->second.popover;
}

GtkWidget *Modals::sheetHeaderOf(Tag tag) const {
  auto it = presented_.find(tag);
  return it == presented_.end() ? nullptr : it->second.header;
}

void Modals::press(Tag tag, const std::string &buttonId) {
  if (const ViewData *config = headerConfigOf(backend_, tag); config && config->emitter) {
    config->emitter->dispatchEvent(
        "pressHeaderBarButtonItem", folly::dynamic::object("buttonId", buttonId), RawEvent::Category::Discrete);
  }
}

void Modals::requestClose(Tag tag) {
  auto it = presented_.find(tag);
  if (it != presented_.end() && it->second.screen) {
    // A sheet's Cancel takes Escape, as its key equivalent does on macOS; otherwise the screen is
    // dismissed natively, and the router follows.
    for (const auto &button : it->second.chrome.buttons) {
      if (button.cancel && !button.disabled) {
        press(tag, button.id);
        return;
      }
    }
    if (const ViewData *d = backend_.data(tag); d && d->emitter) {
      d->emitter->dispatchEvent("dismissed", folly::dynamic::object("dismissCount", 1), RawEvent::Category::Discrete);
    }
    return;
  }
  if (const ViewData *d = backend_.data(tag)) {
    if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(d->emitter)) {
      emitter->onRequestClose({});
    }
  }
}

std::optional<Tag> Modals::front(GtkWindow *window) const {
  std::optional<Tag> front;
  uint64_t latest = 0;
  for (const auto &[tag, presented] : presented_) {
    GtkWidget *surface = backend_.surfaceWidget(presented.surfaceId);
    if (surface && gtk_widget_get_root(surface) == GTK_ROOT(window) && presented.order > latest) {
      latest = presented.order;
      front = tag;
    }
  }
  return front;
}

// Whether a popover on `anchor` would show: it is in a window, and nothing between it and the
// window is hidden, as a screen the stack covers is (setCovered). Not whether it is mapped yet, nor
// whether the window is shown: the first mount presents before the window is (GtkWindows::didMount).
static bool anchorOnScreen(GtkWidget *anchor) {
  GtkWidget *root = GTK_WIDGET(gtk_widget_get_root(anchor));
  if (!root) {
    return false;
  }
  for (GtkWidget *w = anchor; w != root; w = gtk_widget_get_parent(w)) {
    if (!gtk_widget_get_visible(w) || !gtk_widget_get_child_visible(w)) {
      return false;
    }
  }
  return true;
}

bool Modals::pressDefault(Tag tag) {
  auto it = presented_.find(tag);
  if (it == presented_.end()) {
    return false;
  }
  for (const auto &button : it->second.chrome.buttons) {
    if (button.isDefault && !button.disabled) {
      press(tag, button.id);
      return true;
    }
  }
  return false;
}

Tag Modals::frontOf(SurfaceId surfaceId) const {
  const std::pair<const Tag, Presented> *front = nullptr;
  for (const auto &entry : presented_) {
    if (entry.second.surfaceId == surfaceId && (!front || entry.second.order > front->second.order)) {
      front = &entry;
    }
  }
  return front ? front->first : 0;
}

void Modals::requestCloseFront(SurfaceId surfaceId) {
  if (Tag front = frontOf(surfaceId)) {
    requestClose(front);
  }
}

bool Modals::pressDefaultFront(SurfaceId surfaceId) {
  Tag front = frontOf(surfaceId);
  return front && pressDefault(front);
}

void Modals::present(SurfaceId surfaceId, Tag tag) {
  const ViewData *d = backend_.data(tag);
  GtkWidget *surface = backend_.surfaceWidget(surfaceId);
  const WindowChrome *chrome = chromeOf(surface);
  if (!d || !d->props || !chrome || presented_.count(tag)) {
    return;
  }
  installSheetStyle();
  Presented p{.surfaceId = surfaceId, .presentation = d->desktop.presentation, .screen = d->component == "RNSScreen", .order = ++presentations_};
  std::optional<Tag> anchor = d->desktop.anchor;
  if (p.screen) {
    p.presentation = screenPresentation(*d->props).value_or(ModalPresentation::Sheet);
    if (const auto *props = dynamic_cast<const ScreenProps *>(d->props.get()); props && props->anchor != 0) {
      anchor = props->anchor;
    }
  }
  // A popover points at its anchor; an anchor that is not on screen leaves it a sheet, as on macOS.
  GtkWidget *anchorWidget = anchor ? backend_.view(*anchor) : nullptr;
  if (anchorWidget && !anchorOnScreen(anchorWidget)) {
    anchorWidget = nullptr;
  }
  if (p.presentation == ModalPresentation::Popover && !anchorWidget) {
    p.presentation = ModalPresentation::Sheet;
  } else if (anchorWidget) {
    p.presentation = ModalPresentation::Popover;
  }
  GtkRoot *root = gtk_widget_get_root(surface);
  if (GtkWidget *focus = root ? gtk_root_get_focus(root) : nullptr) {
    p.opener = GTK_WIDGET(g_object_ref(focus));
  }
  p.slot = GTK_WIDGET(g_object_ref_sink(makeHostSlot()));
  backend_.hostView(tag, p.slot);
  // libadwaita presents a dialog in a window of its own outside an AdwWindow, or over one that is
  // not resizable: the sheet is drawn over the window there instead.
  bool inWindow = root && (ADW_IS_WINDOW(root) || ADW_IS_APPLICATION_WINDOW(root)) && gtk_window_get_resizable(GTK_WINDOW(root));
  if (p.presentation == ModalPresentation::Sheet) {
    // What a sheet shows: the screen's header, when it has one (dress), over the content.
    p.card = GTK_WIDGET(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
    gtk_box_append(GTK_BOX(p.card), p.slot);
  }
  if (p.presentation == ModalPresentation::Popover) {
    GtkWidget *popover = gtk_popover_new();
    gtk_popover_set_child(GTK_POPOVER(popover), p.slot);
    gtk_popover_set_autohide(GTK_POPOVER(popover), TRUE);
    gtk_widget_set_parent(popover, anchorWidget);
    // GTK moves the focus into an autohide popover as it shows. With nothing in it to take the
    // focus and nothing focused in the window, as at launch, GTK passes the window's null focus to
    // gtk_widget_is_ancestor, a critical: the popover takes the focus itself first then, and a
    // field in it still takes it from there.
    gtk_widget_set_focusable(popover, TRUE);
    g_signal_connect(popover, "map", G_CALLBACK(+[](GtkWidget *shown, gpointer) {
      if (GtkRoot *root = gtk_widget_get_root(shown); root && !gtk_root_get_focus(root)) {
        gtk_widget_grab_focus(shown);
      }
    }), nullptr);
    GdkRectangle rect{0, 0, std::max(1, gtk_widget_get_width(anchorWidget)), std::max(1, gtk_widget_get_height(anchorWidget))};
    gtk_popover_set_pointing_to(GTK_POPOVER(popover), &rect);
    // Closed by GTK (a click outside, or Escape): the app decides, as for Escape on a sheet.
    g_signal_connect_data(
        popover, "closed", G_CALLBACK(+[](GtkPopover *, gpointer data) {
          auto *self = static_cast<CloseTarget *>(data);
          if (self->first->presented_.count(self->second)) {
            self->first->requestClose(self->second);
            // GTK hid it to emit this. Until the app unmounts the modal, it is still presented.
            g_idle_add_full(
                G_PRIORITY_DEFAULT_IDLE, +[](gpointer data) -> gboolean {
                  auto *again = static_cast<CloseTarget *>(data);
                  auto it = again->first->presented_.find(again->second);
                  if (it != again->first->presented_.end() && it->second.popover) {
                    gtk_popover_popup(GTK_POPOVER(it->second.popover));
                  }
                  return G_SOURCE_REMOVE;
                },
                new CloseTarget(*self), [](gpointer data) { delete static_cast<CloseTarget *>(data); });
          }
        }),
        new CloseTarget(this, tag), [](gpointer data, GClosure *) { delete static_cast<CloseTarget *>(data); },
        GConnectFlags(0));
    p.popover = GTK_WIDGET(g_object_ref(popover));
  } else if (p.presentation == ModalPresentation::Sheet && inWindow && haveAdwDialog()) {
    // AdwDialog by its type and properties, which 1.4's headers do not declare. It asks before it
    // closes, and the app decides, as Escape on macOS asks.
    GtkWidget *dialog = GTK_WIDGET(g_object_new(g_type_from_name("AdwDialog"), "can-close", FALSE, "child", p.card, nullptr));
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
  } else if (p.presentation == ModalPresentation::Sheet) {
    // libadwaita 1.4: a dimmed backdrop over the window's content with the card in its middle.
    GtkWidget *backdrop = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_add_css_class(backdrop, "ngn-backdrop");
    gtk_widget_set_halign(p.card, GTK_ALIGN_CENTER);
    gtk_widget_set_valign(p.card, GTK_ALIGN_CENTER);
    gtk_widget_set_vexpand(p.card, TRUE);
    gtk_widget_add_css_class(p.card, "ngn-sheet");
    gtk_widget_set_overflow(p.card, GTK_OVERFLOW_HIDDEN);
    gtk_box_append(GTK_BOX(backdrop), p.card);
    p.layer = backdrop;
  } else {
    p.layer = p.slot;
  }
  if (p.layer) {
    // Each layer's Escape reaches the presentation in front: GTK runs the first one registered.
    onKey(p.layer, "Escape", [this, surfaceId] {
      requestCloseFront(surfaceId);
      return true;
    });
    gtk_overlay_add_overlay(GTK_OVERLAY(chrome->overlay), p.layer);
  }
  if (GtkWidget *keys = p.dialog ? p.dialog : p.layer) {
    // As for Escape, whichever layer's shortcut runs first, the presentation in front takes Return.
    // With no enabled default button it is still consumed, so it does not reach the window's own
    // default button behind the sheet.
    onKey(keys, "Return|KP_Enter", [this, surfaceId] {
      bool pressed = pressDefaultFront(surfaceId);
      return pressed || frontOf(surfaceId) != 0;
    });
  }
  backend_.hooks.containerRoot(tag, true);
  backend_.hooks.attachInput(p.slot, surfaceId, tag);
  auto &presented = presented_[tag] = p;
  dress(tag, presented);
  fit(tag, presented);
  if (presented.dialog) {
    adwFunction<void (*)(GtkWidget *, GtkWidget *)>("adw_dialog_present")(presented.dialog, surface);
  }
  if (presented.popover) {
    gtk_popover_popup(GTK_POPOVER(presented.popover));
  }
  gtk_widget_child_focus(presented.slot, GTK_DIR_TAB_FORWARD);
  if (auto emitter = std::dynamic_pointer_cast<const ModalHostViewEventEmitter>(d->emitter)) {
    emitter->onShow({});
  }
}

void Modals::dress(Tag tag, Presented &p) {
  const ViewData *d = backend_.data(tag);
  const ViewData *config = p.screen ? headerConfigOf(backend_, tag) : nullptr;
  auto bar = config && config->props ? headerBar(*config->props) : std::nullopt;
  SheetChrome chrome = bar ? sheetChrome(*bar, p.presentation) : SheetChrome{};
  // Named by the view's own accessibility label, or the screen's title.
  std::string label;
  if (auto props = d ? std::dynamic_pointer_cast<const ViewProps>(d->props) : nullptr) {
    label = presentationLabel(props->accessibilityLabel, chrome.label);
  }
  GtkWidget *named = p.popover ? p.popover : p.dialog ? p.dialog : p.layer;
  if (named && (label != p.label || !p.labelled)) {
    p.label = label;
    p.labelled = true;
    gtk_accessible_update_property(GTK_ACCESSIBLE(named), GTK_ACCESSIBLE_PROPERTY_LABEL, label.c_str(), -1);
  }
  if (chrome == p.chrome && (p.header || (chrome.heading.empty() && chrome.buttons.empty()))) {
    return;
  }
  p.chrome = chrome;
  if (p.header) {
    gtk_box_remove(GTK_BOX(p.card), p.header);
    g_object_unref(p.header);
    p.header = nullptr;
  }
  if (!p.card || (chrome.heading.empty() && chrome.buttons.empty())) {
    return;
  }
  // A sheet's header is the dialog's own header bar, as GNOME's dialogs have it: the title in the
  // middle, the left items (Cancel) at the start, the right ones at the end, the last of them the
  // default on Return. Escape presses Cancel (requestClose).
  GtkWidget *header = adw_header_bar_new();
  adw_header_bar_set_show_start_title_buttons(ADW_HEADER_BAR(header), FALSE);
  adw_header_bar_set_show_end_title_buttons(ADW_HEADER_BAR(header), FALSE);
  adw_header_bar_set_title_widget(ADW_HEADER_BAR(header), adw_window_title_new(chrome.heading.c_str(), ""));
  // sheetChrome keeps the left items first: those of the bar's left items that became buttons.
  size_t left = static_cast<size_t>(std::count_if(bar->left.begin(), bar->left.end(), [](const BarButton &b) {
    return !b.spacing && !(b.title.empty() && b.accessibilityLabel.empty());
  }));
  std::vector<GtkWidget *> end;
  for (size_t i = 0; i < chrome.buttons.size(); ++i) {
    const SheetButton &b = chrome.buttons[i];
    GtkWidget *button = gtk_button_new_with_label(b.title.c_str());
    gtk_widget_set_sensitive(button, !b.disabled);
    if (b.isDefault) {
      gtk_widget_add_css_class(button, "suggested-action");
    }
    auto *target = new PressTarget(nullptr, {tag, b.id});
    g_object_set_data(G_OBJECT(button), "ngn-modals", this);
    g_signal_connect_data(
        button, "clicked", G_CALLBACK(+[](GtkButton *button, gpointer data) {
          auto *self = static_cast<Modals *>(g_object_get_data(G_OBJECT(button), "ngn-modals"));
          auto *p = static_cast<PressTarget *>(data);
          self->press(p->second.first, p->second.second);
        }),
        target, [](gpointer data, GClosure *) { delete static_cast<PressTarget *>(data); }, GConnectFlags(0));
    if (i < left) {
      adw_header_bar_pack_start(ADW_HEADER_BAR(header), button);
    } else {
      end.push_back(button);
    }
  }
  for (auto it = end.rbegin(); it != end.rend(); ++it) {
    adw_header_bar_pack_end(ADW_HEADER_BAR(header), *it);
  }
  p.header = GTK_WIDGET(g_object_ref_sink(header));
  gtk_box_prepend(GTK_BOX(p.card), p.header);
  p.size = {0, 0};
}

void Modals::fit(Tag tag, Presented &p) {
  GtkWidget *surface = backend_.surfaceWidget(p.surfaceId);
  const ViewData *d = backend_.data(tag);
  if (!surface || !d) {
    return;
  }
  Size window{static_cast<Float>(gtk_widget_get_width(surface)), static_cast<Float>(gtk_widget_get_height(surface))};
  Size size = window;
  auto node = sheetNodes_ ? sheetNodes_(p.surfaceId, tag) : std::nullopt;
  if (p.presentation == ModalPresentation::Cover) {
    // Below the header bar, which the window's content may run under: the cover starts where the
    // bar ends.
    int top = static_cast<int>(chromeInsets(surface).insets.top);
    gtk_widget_set_margin_top(p.layer, top);
    size.height = std::max<Float>(0, window.height - static_cast<Float>(top));
  } else if (p.presentation == ModalPresentation::Sheet) {
    // The content at the core's size, below the header, which the sheet stays within the window with.
    Float header = p.header ? static_cast<Float>(naturalHeight(p.header)) : 0;
    size = sheetSize(node.value_or(SheetNode{}), window);
    size.height = std::max<Float>(0, std::min(size.height + header, window.height) - header);
  } else if (p.presentation == ModalPresentation::Popover) {
    // Its content's size once that has laid out; until then as much as a popover takes.
    Size measured = node ? popoverSize(*node, window) : Size{0, 0};
    size = measured.width >= 1 && measured.height >= 1
        ? measured
        : Size{std::min(window.width, kPopoverMax), std::min(window.height, kPopoverMax)};
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
    int header = p.header ? naturalHeight(p.header) : 0;
    g_object_set(p.dialog, "content-width", pixels.first, "content-height", pixels.second + header, nullptr);
  }
  if (auto state = std::dynamic_pointer_cast<const ConcreteState<ModalHostViewState>>(d->state)) {
    state->updateState(ModalHostViewState(size));
  } else if (auto pane = std::dynamic_pointer_cast<const ConcreteState<SplitPaneState>>(d->state)) {
    if (pane->getData().size != size) {
      pane->updateState(SplitPaneState{.size = size});
    }
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
  if (p.popover) {
    gtk_popover_popdown(GTK_POPOVER(p.popover));
    if (gtk_widget_get_parent(p.popover)) {
      gtk_widget_unparent(p.popover);
    }
    g_object_unref(p.popover);
  }
  if (p.layer) {
    if (const WindowChrome *chrome = chromeOf(backend_.surfaceWidget(p.surfaceId)); chrome && gtk_widget_get_parent(p.layer)) {
      gtk_overlay_remove_overlay(GTK_OVERLAY(chrome->overlay), p.layer);
    }
  }
  if (p.header) {
    g_object_unref(p.header);
  }
  if (p.card) {
    g_object_unref(p.card);
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
