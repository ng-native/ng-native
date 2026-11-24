#include "split-view.h"

#include "gtk-backend.h"
#include "screens.h"
#include "svg-icon.h"
#include "view-widget.h"

#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/RawEvent.h>

#include <adwaita.h>

#include <algorithm>
#include <cmath>
#include <set>
#include <string>

using facebook::react::ConcreteState;
using facebook::react::Float;
using facebook::react::RawEvent;
using facebook::react::Rect;
using facebook::react::Size;

// A pane's slot in its page: it asks for no size, puts the pane at its top left at the slot's size,
// and reports that size, which the pane's layout takes.
struct _NgnPaneSlot {
  GtkWidget parent;
  ngn::gtk::SplitViews *splits;
  ngn::Tag pane;
};

G_DECLARE_FINAL_TYPE(NgnPaneSlot, ngn_pane_slot, NGN, PANE_SLOT, GtkWidget)
G_DEFINE_TYPE(NgnPaneSlot, ngn_pane_slot, GTK_TYPE_WIDGET)

namespace ngn::gtk {
// What a pane slot calls as it is allocated.
void paneSlotAllocated(SplitViews *splits, Tag pane, int width, int height);
} // namespace ngn::gtk

static void ngn_pane_slot_measure(GtkWidget *, GtkOrientation, int, int *minimum, int *natural, int *, int *) {
  *minimum = 0;
  *natural = 0;
}

static void ngn_pane_slot_size_allocate(GtkWidget *widget, int width, int height, int) {
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    GtkAllocation all{0, 0, width, height};
    gtk_widget_size_allocate(child, &all, -1);
  }
  auto *slot = NGN_PANE_SLOT(widget);
  if (slot->splits && slot->pane >= 0 && width > 0 && height > 0) {
    ngn::gtk::paneSlotAllocated(slot->splits, slot->pane, width, height);
  }
}

static void ngn_pane_slot_dispose(GObject *object) {
  while (GtkWidget *child = gtk_widget_get_first_child(GTK_WIDGET(object))) {
    gtk_widget_unparent(child);
  }
  G_OBJECT_CLASS(ngn_pane_slot_parent_class)->dispose(object);
}

static void ngn_pane_slot_class_init(NgnPaneSlotClass *klass) {
  G_OBJECT_CLASS(klass)->dispose = ngn_pane_slot_dispose;
  GTK_WIDGET_CLASS(klass)->measure = ngn_pane_slot_measure;
  GTK_WIDGET_CLASS(klass)->size_allocate = ngn_pane_slot_size_allocate;
}

static void ngn_pane_slot_init(NgnPaneSlot *slot) {
  slot->splits = nullptr;
  slot->pane = -1;
  gtk_widget_set_overflow(GTK_WIDGET(slot), GTK_OVERFLOW_HIDDEN);
}

namespace ngn::gtk {

namespace {

// The side of a row's SVG icon: Adwaita's for a symbolic icon.
constexpr int kRowIconSize = 16;

// The label of the item the app selects in a list, or null where it selects none.
const char *selectedLabel(const SourceList &list) {
  auto chosen = selectedRow(list);
  for (const auto &group : list.groups) {
    for (const auto &row : group.rows) {
      if (chosen == row.tag) {
        return row.label.c_str();
      }
    }
  }
  return nullptr;
}

void send(const ViewData *d, const char *name, folly::dynamic payload) {
  if (d && d->emitter) {
    d->emitter->dispatchEvent(name, std::move(payload), RawEvent::Category::Discrete);
  }
}

const SplitPaneProps *paneProps(const ViewData *d) {
  return d ? dynamic_cast<const SplitPaneProps *>(d->props.get()) : nullptr;
}

// Rows at the height Yoga gives them (kSidebarRowHeight), so the list draws in the space its
// sections take in layout.
void addSourceListStyle() {
  static bool added = false;
  if (added || !gdk_display_get_default()) {
    return;
  }
  added = true;
  GtkCssProvider *provider = gtk_css_provider_new();
  std::string css = ".ngn-source-list { background: transparent; margin: 0; padding: 0; }"
                    ".ngn-source-list > row { min-height: " +
      std::to_string(static_cast<int>(kSidebarRowHeight)) +
      "px; padding-top: 0; padding-bottom: 0; margin-top: 0; margin-bottom: 0; }"
      ".ngn-source-list > row.ngn-section-title { min-height: " +
      std::to_string(static_cast<int>(kSidebarHeaderHeight)) + "px; }";
  gtk_css_provider_load_from_data(provider, css.c_str(), -1);
  gtk_style_context_add_provider_for_display(
      gdk_display_get_default(), GTK_STYLE_PROVIDER(provider), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(provider);
}

// An inset content pane: its page on the sidebar's backdrop, the header bar over it drawing none of
// its own, and the slot a card in the window's colour, kInsetContentMargin in from the page's edges
// and below the header bar, clipped to rounded corners (a slot's overflow is hidden).
void addInsetContentStyle() {
  static bool added = false;
  if (added || !gdk_display_get_default()) {
    return;
  }
  added = true;
  GtkCssProvider *provider = gtk_css_provider_new();
  std::string css = ".ngn-inset-content { background-color: @sidebar_bg_color; }"
                    ".ngn-inset-content headerbar, .ngn-inset-content .top-bar { background: none; box-shadow: none; border: none; }"
                    ".ngn-inset-card { background-color: @window_bg_color; margin: " +
      std::to_string(static_cast<int>(kInsetContentMargin)) + "px; border-radius: " +
      std::to_string(static_cast<int>(kInsetContentRadius)) + "px; }";
  gtk_css_provider_load_from_data(provider, css.c_str(), -1);
  gtk_style_context_add_provider_for_display(
      gdk_display_get_default(), GTK_STYLE_PROVIDER(provider), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(provider);
}

struct RowTarget {
  SplitViews *splits;
  Tag parent;
};

constexpr const char *kTabsHost = "RNSTabsHostIOS";
constexpr const char *kTabScreen = "RNSTabsScreenIOS";

// Takes a source list's box out of wherever it is: a view, or a tab list's scrolled window.
void detachBox(GtkWidget *box) {
  GtkWidget *parent = gtk_widget_get_parent(box);
  if (parent && GTK_IS_VIEWPORT(parent)) {
    gtk_viewport_set_child(GTK_VIEWPORT(parent), nullptr);
  } else if (parent) {
    gtk_widget_unparent(box);
  }
}

} // namespace

void paneSlotAllocated(SplitViews *splits, Tag pane, int width, int height) {
  splits->reportSizeFromSlot(pane, width, height);
}

SplitViews::~SplitViews() {
  if (flush_ != 0) {
    g_source_remove(flush_);
  }
  if (choose_ != 0) {
    g_source_remove(choose_);
  }
  for (auto &[parent, l] : lists_) {
    if (l.refill != 0) {
      g_source_remove(l.refill);
    }
    for (Tag tag : l.hosted) {
      backend_.unhostView(tag);
    }
    for (GtkWidget *box : l.boxes) {
      detachBox(box);
      g_object_unref(box);
    }
  }
  for (auto &[tag, s] : splits_) {
    tearDown(s);
  }
}

void SplitViews::moveHeaderBar(Split &s, bool overContent) {
  const WindowChrome *chrome = chromeOf(backend_.surfaceWidget(s.surfaceId));
  if (!chrome || !s.contentToolbar) {
    return;
  }
  GtkWidget *header = chrome->headerBar;
  bool overIt = gtk_widget_is_ancestor(header, s.contentToolbar);
  if (overIt == overContent) {
    return;
  }
  g_object_ref(header);
  if (overContent) {
    adw_toolbar_view_remove(ADW_TOOLBAR_VIEW(chrome->toolbarView), header);
    adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(s.contentToolbar), header);
  } else {
    adw_toolbar_view_remove(ADW_TOOLBAR_VIEW(s.contentToolbar), header);
    // First again, above a menu bar.
    GtkWidget *menuBar = chrome->menuBar;
    if (menuBar) {
      g_object_ref(menuBar);
      adw_toolbar_view_remove(ADW_TOOLBAR_VIEW(chrome->toolbarView), menuBar);
    }
    adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(chrome->toolbarView), header);
    if (menuBar) {
      adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(chrome->toolbarView), menuBar);
      g_object_unref(menuBar);
    }
  }
  g_object_unref(header);
}

namespace {

// Whether `widget` is in a window and shown there: no ancestor is hidden, or a covered child.
bool shownInWindow(GtkWidget *widget) {
  if (!widget || !gtk_widget_get_root(widget)) {
    return false;
  }
  for (GtkWidget *w = widget; w; w = gtk_widget_get_parent(w)) {
    if (!gtk_widget_get_visible(w) || !gtk_widget_get_child_visible(w)) {
      return false;
    }
  }
  return true;
}

} // namespace

void SplitViews::placeHeader(SurfaceId surfaceId) {
  Split *shown = nullptr;
  for (auto &[tag, s] : splits_) {
    if (s.surfaceId == surfaceId && s.window && s.contentToolbar && shownInWindow(backend_.view(tag))) {
      shown = &s;
      break;
    }
  }
  // Back over the window first, from a split view that is not the one it goes to.
  for (auto &[tag, s] : splits_) {
    if (s.surfaceId == surfaceId && &s != shown) {
      moveHeaderBar(s, false);
    }
  }
  if (shown) {
    moveHeaderBar(*shown, true);
  }
}

void SplitViews::placeHeaders() {
  std::set<SurfaceId> surfaces;
  for (const auto &[tag, s] : splits_) {
    if (s.window && s.contentToolbar) {
      surfaces.insert(s.surfaceId);
    }
  }
  for (SurfaceId surfaceId : surfaces) {
    placeHeader(surfaceId);
  }
}

void SplitViews::tearDown(Split &s) {
  moveHeaderBar(s, false);
  for (Tag pane : {s.sidebar, s.content}) {
    if (pane >= 0) {
      backend_.unhostView(pane);
      backend_.hooks.detachInput(pane);
      backend_.hooks.containerRoot(pane, false);
    }
  }
  if (s.tabs) {
    // The tab list's box leaves with the scrolled window's viewport, and stays in lists_.
    Tag host = NGN_PANE_SLOT(s.contentSlot)->pane;
    for (Tag screen : s.screens) {
      backend_.unhostView(screen);
    }
    backend_.hooks.detachInput(host);
    backend_.hooks.containerRoot(host, false);
    s.tabList = nullptr;
  }
  if (s.bin && gtk_widget_get_parent(s.bin)) {
    gtk_widget_unparent(s.bin);
  }
  g_clear_object(&s.bin);
}

void SplitViews::place(SurfaceId surfaceId, Tag split, bool window) {
  GtkWidget *widget = backend_.view(split);
  ViewData *d = viewData(widget);
  if (!d || splits_.contains(split)) {
    return;
  }
  auto &s = splits_[split];
  s.surfaceId = surfaceId;
  s.window = window;
  s.tabs = d->component == kTabsHost;
  s.view = adw_navigation_split_view_new();
  auto slot = [this](GtkWidget *&out) {
    out = GTK_WIDGET(g_object_new(ngn_pane_slot_get_type(), nullptr));
    NGN_PANE_SLOT(out)->splits = this;
    return out;
  };
  GtkWidget *sidebarChild = slot(s.sidebarSlot);
  GtkWidget *contentChild = slot(s.contentSlot);
  const WindowChrome *chrome = window ? chromeOf(backend_.surfaceWidget(surfaceId)) : nullptr;
  bool fullHeight = chrome && !runsUnderHeaderBar(*chrome);
  if (fullHeight) {
    sidebarChild = adw_toolbar_view_new();
    s.sidebarHeader = adw_header_bar_new();
    adw_header_bar_set_show_title(ADW_HEADER_BAR(s.sidebarHeader), FALSE);
    adw_toolbar_view_add_top_bar(ADW_TOOLBAR_VIEW(sidebarChild), s.sidebarHeader);
    // A compact window shows the sidebar alone while the window's header bar, with the sidebar
    // button, is on the hidden content: this brings the content back.
    s.contentButton = gtk_button_new_from_icon_name("go-next-symbolic");
    gtk_widget_set_tooltip_text(s.contentButton, "Show Content");
    gtk_accessible_update_property(GTK_ACCESSIBLE(s.contentButton), GTK_ACCESSIBLE_PROPERTY_LABEL, "Show Content", -1);
    gtk_widget_set_visible(s.contentButton, FALSE);
    g_signal_connect_data(s.contentButton, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
      auto *t = static_cast<RowTarget *>(data);
      if (auto it = t->splits->splits_.find(t->parent); it != t->splits->splits_.end()) {
        t->splits->toggle(it->second.surfaceId);
      }
    }), new RowTarget{this, split}, [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
    adw_header_bar_pack_start(ADW_HEADER_BAR(s.sidebarHeader), s.contentButton);
    adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(sidebarChild), s.sidebarSlot);
    contentChild = s.contentToolbar = adw_toolbar_view_new();
    adw_toolbar_view_set_content(ADW_TOOLBAR_VIEW(contentChild), s.contentSlot);
  }
  if (s.tabs && !window) {
    // A tabs host that is not the window's has no header bar of its own to carry a sidebar button,
    // and its tab list is its sidebar: a button over the content brings it forward while compact.
    GtkWidget *overlay = gtk_overlay_new();
    gtk_overlay_set_child(GTK_OVERLAY(overlay), contentChild);
    s.sidebarButton = gtk_button_new_from_icon_name("sidebar-show-symbolic");
    gtk_widget_add_css_class(s.sidebarButton, "circular");
    gtk_widget_set_halign(s.sidebarButton, GTK_ALIGN_START);
    gtk_widget_set_valign(s.sidebarButton, GTK_ALIGN_START);
    gtk_widget_set_margin_start(s.sidebarButton, 6);
    gtk_widget_set_margin_top(s.sidebarButton, 6);
    gtk_widget_set_tooltip_text(s.sidebarButton, "Show Tabs");
    gtk_accessible_update_property(GTK_ACCESSIBLE(s.sidebarButton), GTK_ACCESSIBLE_PROPERTY_LABEL, "Show Tabs", -1);
    gtk_widget_set_visible(s.sidebarButton, FALSE);
    g_signal_connect_data(s.sidebarButton, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
      auto *t = static_cast<RowTarget *>(data);
      t->splits->toggleHost(t->parent);
    }), new RowTarget{this, split}, [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
    gtk_overlay_add_overlay(GTK_OVERLAY(overlay), s.sidebarButton);
    contentChild = overlay;
  }
  AdwNavigationPage *sidebar = adw_navigation_page_new(sidebarChild, "Sidebar");
  // Titled by the sidebar's selected row (titleContent), or a tabs host's chosen tab: none until then.
  AdwNavigationPage *content = adw_navigation_page_new(contentChild, "");
  // The router's back and forward are the only history: the stack's own pop is off.
  adw_navigation_page_set_can_pop(content, FALSE);
  adw_navigation_split_view_set_sidebar(ADW_NAVIGATION_SPLIT_VIEW(s.view), sidebar);
  adw_navigation_split_view_set_content(ADW_NAVIGATION_SPLIT_VIEW(s.view), content);
  s.bin = GTK_WIDGET(g_object_ref_sink(adw_breakpoint_bin_new()));
  // Smaller than the breakpoint, as the bin asks; the split view takes what Yoga gives the view.
  gtk_widget_set_size_request(s.bin, 1, 1);
  adw_breakpoint_bin_set_child(ADW_BREAKPOINT_BIN(s.bin), s.view);
  s.breakpoint = adw_breakpoint_new(adw_breakpoint_condition_new_length(ADW_BREAKPOINT_CONDITION_MAX_WIDTH, 1, ADW_LENGTH_UNIT_PX));
  auto *target = new RowTarget{this, split};
  g_signal_connect_data(s.breakpoint, "apply", G_CALLBACK(+[](AdwBreakpoint *, gpointer data) {
    auto *t = static_cast<RowTarget *>(data);
    t->splits->setCompact(t->parent, true);
  }), target, [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
  g_signal_connect_data(s.breakpoint, "unapply", G_CALLBACK(+[](AdwBreakpoint *, gpointer data) {
    auto *t = static_cast<RowTarget *>(data);
    t->splits->setCompact(t->parent, false);
  }), new RowTarget(*target), [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
  adw_breakpoint_bin_add_breakpoint(ADW_BREAKPOINT_BIN(s.bin), s.breakpoint);
  d->split = s.bin;
  gtk_widget_set_parent(s.bin, widget);
  if (s.tabs) {
    // The tabs fill the sidebar's page; the screens share the content's, which is a container of
    // its own rooted at the host, as on macOS.
    s.tabList = gtk_scrolled_window_new();
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(s.tabList), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    gtk_widget_set_parent(s.tabList, s.sidebarSlot);
    NGN_PANE_SLOT(s.contentSlot)->pane = split;
    backend_.hooks.containerRoot(split, true);
    backend_.hooks.attachInput(s.contentSlot, surfaceId, split);
  }
  // The panes (a tabs host's screens) already mounted, found before hosting moves them out.
  std::vector<Tag> panes;
  for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
    ViewData *child = viewData(c);
    bool pane = child && (s.tabs ? child->component == kTabScreen
                                 : child->component == SidebarComponentName || child->component == SplitContentComponentName);
    if (pane) {
      panes.push_back(child->tag);
    }
  }
  for (Tag pane : panes) {
    if (s.tabs) {
      hostScreen(s, pane);
    } else {
      host(s, pane);
    }
  }
  if (s.tabs) {
    showTabList(split);
  }
  applySidebar(s);
  show(s);
  gtk_widget_queue_allocate(widget);
  if (fullHeight) {
    placeHeader(surfaceId);
    // A header bar in a page shows the page's title when it has no title widget of its own: the
    // window's, as it showed over the whole window.
    // libadwaita asks every page for a title, so an untitled window leaves the page's.
    // The surface's window: a split view placed inside a screen still being pushed has no root yet.
    // A tabs host's page takes the chosen tab's title instead (showTabList).
    GtkRoot *root = s.tabs ? nullptr : gtk_widget_get_root(backend_.surfaceWidget(surfaceId));
    if (root && GTK_IS_WINDOW(root)) {
      g_object_bind_property_full(
          root, "title", content, "title", G_BINDING_SYNC_CREATE,
          +[](GBinding *, const GValue *from, GValue *to, gpointer) -> gboolean {
            const char *title = g_value_get_string(from);
            if (!title || !*title) {
              return FALSE;
            }
            g_value_set_string(to, title);
            return TRUE;
          },
          nullptr, nullptr, nullptr);
    }
  }
  if (window) {
    backend_.headers().refreshChrome(surfaceId);
  }
}

void SplitViews::applySidebar(Split &s) {
  applyWidths(s);
  const auto *p = paneProps(backend_.data(s.sidebar));
  if (!p) {
    return;
  }
  s.collapsedProp = p->collapsed;
  if (auto collapsed = s.collapse.propChanged(p->collapsed)) {
    s.folding.setCollapsed(*collapsed);
  }
  // What the user left it as last time wins over the app's prop, which hears of it, as an
  // NSSplitView's autosave restores its divider on macOS.
  auto key = sidebarCollapsedKey(p->autosaveName);
  if (auto saved = key && readPreference ? savedSidebarCollapsed(readPreference(*key)) : std::nullopt) {
    if (s.collapse.toolkitChanged(*saved)) {
      send(backend_.data(s.sidebar), "sidebarCollapse", folly::dynamic::object("collapsed", *saved));
    }
    s.folding.setCollapsed(*saved);
  }
}

void SplitViews::host(Split &s, Tag pane) {
  const ViewData *d = backend_.data(pane);
  if (!d) {
    return;
  }
  bool sidebar = d->component == SidebarComponentName;
  GtkWidget *slot = sidebar ? s.sidebarSlot : s.contentSlot;
  (sidebar ? s.sidebar : s.content) = pane;
  NGN_PANE_SLOT(slot)->pane = pane;
  backend_.hostView(pane, slot);
  backend_.hooks.containerRoot(pane, true);
  backend_.hooks.attachInput(slot, s.surfaceId, pane);
  // A sidebar whose lists were filled before it came here titles the content now: its own, and
  // those of views within it, which are kept by their own tags.
  if (GtkWidget *widget = sidebar ? backend_.view(pane) : nullptr) {
    titleContent(widget, nullptr);
  }
  if (!sidebar) {
    applyContentStyle(s);
  }
}

void SplitViews::applyContentStyle(Split &s) {
  bool inset = insetContent(paneProps(backend_.data(s.content)));
  if (inset) {
    addInsetContentStyle();
  }
  GtkWidget *page = GTK_WIDGET(adw_navigation_split_view_get_content(ADW_NAVIGATION_SPLIT_VIEW(s.view)));
  for (auto [widget, name] : {std::pair{page, "ngn-inset-content"}, std::pair{s.contentSlot, "ngn-inset-card"}}) {
    if (inset) {
      gtk_widget_add_css_class(widget, name);
    } else {
      gtk_widget_remove_css_class(widget, name);
    }
  }
}

void SplitViews::hostScreen(Split &s, Tag screen) {
  // A screen Fabric moved here from another tabs host leaves that host's list, which would
  // otherwise unhost it, and size it, as it goes.
  for (auto &[tag, other] : splits_) {
    if (&other != &s) {
      std::erase(other.screens, screen);
    }
  }
  backend_.hostView(screen, s.contentSlot);
  if (std::find(s.screens.begin(), s.screens.end(), screen) == s.screens.end()) {
    s.screens.push_back(screen);
  }
  // A screen added later takes the size the others have.
  if (int w = gtk_widget_get_width(s.contentSlot), h = gtk_widget_get_height(s.contentSlot); w > 0 && h > 0) {
    reportSizeFromSlot(NGN_PANE_SLOT(s.contentSlot)->pane, w, h);
  }
}

void SplitViews::showTabList(Tag split) {
  auto it = splits_.find(split);
  auto l = lists_.find(split);
  if (it == splits_.end() || !it->second.tabList || l == lists_.end() || l->second.boxes.empty()) {
    return;
  }
  // The content page's title, which the header bar shows when the tab's screen sets none of its own.
  auto chosen = selectedRow(l->second.lists[0]);
  for (const auto &group : l->second.lists[0].groups) {
    for (const auto &row : group.rows) {
      if (chosen == row.tag && !row.label.empty()) {
        adw_navigation_page_set_title(adw_navigation_split_view_get_content(ADW_NAVIGATION_SPLIT_VIEW(it->second.view)), row.label.c_str());
      }
    }
  }
  GtkWidget *box = l->second.boxes[0];
  GtkWidget *viewport = gtk_widget_get_parent(box);
  if (viewport && gtk_widget_get_parent(viewport) == it->second.tabList) {
    return;
  }
  detachBox(box);
  gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(it->second.tabList), box);
}

void SplitViews::inserted(Tag parent, Tag child) {
  auto it = splits_.find(parent);
  const ViewData *d = backend_.data(child);
  if (it != splits_.end() && it->second.tabs) {
    if (d && d->component == kTabScreen) {
      hostScreen(it->second, child);
    }
    return;
  }
  if (it == splits_.end()) {
    retitleSidebarsHolding(parent);
    return;
  }
  if (!d || (d->component != SidebarComponentName && d->component != SplitContentComponentName)) {
    return;
  }
  host(it->second, child);
  if (d->component == SidebarComponentName) {
    applySidebar(it->second);
    show(it->second);
  }
  // A split in another's sidebar: the pane's lists may title that one's content too.
  retitleSidebarsHolding(parent);
}

void SplitViews::removed(Tag parent, Tag child) {
  // The sidebar out of its split, kept for another place: no row of it titles this content, and
  // nothing it selects after does. `host` makes it the split's again, put back.
  if (auto it = splits_.find(parent); it != splits_.end() && !it->second.tabs && it->second.sidebar == child) {
    Split &s = it->second;
    adw_navigation_page_set_title(adw_navigation_split_view_get_content(ADW_NAVIGATION_SPLIT_VIEW(s.view)), "");
    // What `host` registered for it, let go here: once the split has forgotten it, `deleted`
    // would not.
    backend_.hooks.detachInput(child);
    backend_.hooks.containerRoot(child, false);
    s.sidebar = -1;
    NGN_PANE_SLOT(s.sidebarSlot)->pane = -1;
  }
  // And a split whose sidebar holds this one, nested: its rows may have titled that content too.
  retitleSidebarsHolding(parent);
}

void SplitViews::retitleSidebarsHolding(Tag parent) {
  GtkWidget *from = backend_.view(parent);
  if (!from) {
    return;
  }
  // Lists under a view of their own in a sidebar came or went with it: the content is titled by
  // what the sidebar holds now, or by nothing.
  for (const auto &[tag, s] : splits_) {
    GtkWidget *pane = s.sidebar >= 0 ? backend_.view(s.sidebar) : nullptr;
    if (!s.tabs && pane && (from == pane || gtk_widget_is_ancestor(from, pane))) {
      titleContent(pane, nullptr);
    }
  }
}

std::optional<Tag> SplitViews::splitOf(Tag pane) const {
  for (const auto &[tag, s] : splits_) {
    if (s.sidebar == pane || s.content == pane) {
      return tag;
    }
  }
  return std::nullopt;
}

void SplitViews::applyWidths(Split &s) {
  s.widths = sidebarWidths(paneProps(backend_.data(s.sidebar)));
  auto *view = ADW_NAVIGATION_SPLIT_VIEW(s.view);
  // From the narrowest to the width it starts at, as the window allows: libadwaita's split view
  // has no divider to drag.
  adw_navigation_split_view_set_min_sidebar_width(view, s.widths.minimum);
  adw_navigation_split_view_set_max_sidebar_width(view, s.widths.starting);
  adw_navigation_split_view_set_sidebar_width_fraction(view, 0.25);
  // Compact below the core's width: the breakpoint applies up to a pixel under it.
  double compact = std::max<double>(1, std::ceil(sidebarCompactWidth(s.widths)) - 1);
  adw_breakpoint_set_condition(s.breakpoint, adw_breakpoint_condition_new_length(ADW_BREAKPOINT_CONDITION_MAX_WIDTH, compact, ADW_LENGTH_UNIT_PX));
}

void SplitViews::show(Split &s) {
  auto showing = s.folding.showing();
  auto *view = ADW_NAVIGATION_SPLIT_VIEW(s.view);
  if (adw_navigation_split_view_get_collapsed(view) != showing.stacked) {
    adw_navigation_split_view_set_collapsed(view, showing.stacked);
  }
  if (adw_navigation_split_view_get_show_content(view) != showing.content) {
    adw_navigation_split_view_set_show_content(view, showing.content);
  }
  if (s.contentButton) {
    gtk_widget_set_visible(s.contentButton, showing.stacked && !showing.content);
  }
  // The sidebar button moves with the sidebar: over it beside the content, else to the window's
  // header bar.
  if (s.sidebarButton) {
    gtk_widget_set_visible(s.sidebarButton, showing.stacked && showing.content);
  }
  bool overSidebar = s.window && s.sidebarHeader && !showing.stacked;
  if (overSidebar != s.buttonOverSidebar) {
    s.buttonOverSidebar = overSidebar;
    backend_.headers().refreshChrome(s.surfaceId);
  }
}

void SplitViews::propsChanged(Tag tag) {
  auto split = splitOf(tag);
  if (!split) {
    return;
  }
  auto &s = splits_[*split];
  if (tag == s.content) {
    applyContentStyle(s);
    return;
  }
  if (tag != s.sidebar) {
    return;
  }
  applyWidths(s);
  // Only a change of the collapsed input reaches the toolkit: an unrelated update (a width) leaves
  // the state the user or a saved preference set.
  if (const auto *p = paneProps(backend_.data(tag)); p && s.collapsedProp != p->collapsed) {
    s.collapsedProp = p->collapsed;
    if (auto collapsed = s.collapse.propChanged(p->collapsed)) {
      s.folding.setCollapsed(*collapsed);
      show(s);
      autosave(s);
    }
  }
}

void SplitViews::autosave(const Split &s) {
  const auto *p = paneProps(backend_.data(s.sidebar));
  auto key = p ? sidebarCollapsedKey(p->autosaveName) : std::nullopt;
  if (key && writePreference) {
    writePreference(*key, folly::dynamic(s.collapse.collapsed()));
  }
}

GtkWidget *SplitViews::sidebarHeaderShown(SurfaceId surfaceId) const {
  for (const auto &[tag, s] : splits_) {
    if (s.surfaceId == surfaceId && s.window && s.sidebarHeader && !s.folding.showing().stacked) {
      return s.sidebarHeader;
    }
  }
  return nullptr;
}

void SplitViews::setCompact(Tag split, bool compact) {
  auto it = splits_.find(split);
  if (it == splits_.end() || it->second.folding.compact() == compact) {
    return;
  }
  it->second.folding.setCompact(compact);
  show(it->second);
}

std::optional<Tag> SplitViews::windowSplit(SurfaceId surfaceId) const {
  for (const auto &[tag, s] : splits_) {
    if (s.surfaceId == surfaceId && s.window) {
      return tag;
    }
  }
  return std::nullopt;
}

bool SplitViews::toggle(SurfaceId surfaceId) {
  auto split = windowSplit(surfaceId);
  return split && toggleHost(*split);
}

bool SplitViews::toggleHost(Tag split) {
  auto it = splits_.find(split);
  if (it == splits_.end()) {
    return false;
  }
  auto &s = it->second;
  auto collapsed = s.folding.toggle();
  if (collapsed && s.collapse.toolkitChanged(*collapsed)) {
    send(backend_.data(s.sidebar), "sidebarCollapse", folly::dynamic::object("collapsed", *collapsed));
  }
  show(s);
  if (collapsed) {
    autosave(s);
  }
  return true;
}

void SplitViews::deleted(Tag tag) {
  sizes_.forget(tag);
  if (auto it = splits_.find(tag); it != splits_.end()) {
    SurfaceId surfaceId = it->second.surfaceId;
    bool window = it->second.window;
    if (ViewData *d = backend_.data(tag)) {
      d->split = nullptr;
    }
    tearDown(it->second);
    splits_.erase(it);
    if (window) {
      placeHeader(surfaceId);
      backend_.headers().refreshChrome(surfaceId);
    }
  }
  reported_.erase(tag);
  for (auto &[split, s] : splits_) {
    std::erase(s.screens, tag);
    // The content's title is the deleted sidebar's selected row: taken off with it, while the split
    // still knows which sidebar was its own.
    if (s.sidebar == tag && !s.tabs) {
      adw_navigation_page_set_title(adw_navigation_split_view_get_content(ADW_NAVIGATION_SPLIT_VIEW(s.view)), "");
    }
    for (auto [pane, slot] : {std::pair{&s.sidebar, s.sidebarSlot}, std::pair{&s.content, s.contentSlot}}) {
      if (*pane == tag) {
        backend_.hooks.detachInput(tag);
        backend_.hooks.containerRoot(tag, false);
        *pane = -1;
        NGN_PANE_SLOT(slot)->pane = -1;
        // No content pane, nothing drawn inset.
        if (pane == &s.content) {
          applyContentStyle(s);
        }
      }
    }
  }
  if (auto it = lists_.find(tag); it != lists_.end()) {
    setSourceLists(tag, {});
  }
}

// --- Source lists ------------------------------------------------------------------------------

void SplitViews::setSourceLists(Tag parent, const std::vector<SourceList> &lists) {
  // Only the selection moved (the app's answer to a choice, or the core's to a tab): the rows stay,
  // since the pointer that chose one may still be on it, and the selection moves.
  auto known = lists_.find(parent);
  bool moved = known != lists_.end() && known->second.lists.size() == lists.size() && known->second.boxes.size() == lists.size() &&
      !lists.empty() && known->second.refill == 0;
  for (size_t i = 0; moved && i < lists.size(); i++) {
    moved = known->second.lists[i] == lists[i] || onlySelectionDiffers(known->second.lists[i], lists[i]);
  }
  if (moved) {
    known->second.lists = lists;
    for (size_t i = 0; i < lists.size(); i++) {
      select(known->second, i);
    }
    showTabList(parent);
    return;
  }
  rebuild(parent, lists);
}

void SplitViews::select(Lists &l, size_t index) {
  GtkWidget *box = l.boxes[index];
  auto selected = selectedRow(l.lists[index]);
  GtkListBoxRow *row = nullptr;
  for (GtkWidget *c = gtk_widget_get_first_child(box); c && selected; c = gtk_widget_get_next_sibling(c)) {
    if (GTK_IS_LIST_BOX_ROW(c) && g_object_get_data(G_OBJECT(c), "ngn-row") == GINT_TO_POINTER(*selected)) {
      row = GTK_LIST_BOX_ROW(c);
    }
  }
  if (gtk_list_box_get_selected_row(GTK_LIST_BOX(box)) == row) {
    // No row changes, so none says so: an item selected or not in a folded section has no row,
    // but titles the content all the same.
    titleContent(box, row);
    return;
  }
  l.syncing = true;
  gtk_list_box_select_row(GTK_LIST_BOX(box), row);
  l.syncing = false;
}

void SplitViews::rebuild(Tag parent, const std::vector<SourceList> &lists) {
  auto &l = lists_[parent];
  for (Tag tag : l.hosted) {
    backend_.unhostView(tag);
    backend_.hooks.detachInput(tag);
    backend_.hooks.containerRoot(tag, false);
  }
  l.hosted.clear();
  GtkWidget *parentWidget = backend_.view(parent);
  while (l.boxes.size() > lists.size()) {
    GtkWidget *box = l.boxes.back();
    detachBox(box);
    g_object_unref(box);
    l.boxes.pop_back();
  }
  l.lists = lists;
  if (lists.empty()) {
    // Its rows gone, so is the title they gave the content.
    if (parentWidget) {
      titleContent(parentWidget, nullptr);
    }
    if (l.refill != 0) {
      g_source_remove(l.refill);
    }
    lists_.erase(parent);
    return;
  }
  addSourceListStyle();
  while (l.boxes.size() < lists.size()) {
    GtkWidget *box = GTK_WIDGET(g_object_ref_sink(gtk_list_box_new()));
    gtk_widget_add_css_class(box, "navigation-sidebar");
    gtk_widget_add_css_class(box, "ngn-source-list");
    gtk_list_box_set_selection_mode(GTK_LIST_BOX(box), GTK_SELECTION_SINGLE);
    g_object_set_data_full(G_OBJECT(box), "ngn-frame", new Rect{}, [](gpointer p) { delete static_cast<Rect *>(p); });
    auto *target = new RowTarget{this, parent};
    g_signal_connect_data(box, "row-selected", G_CALLBACK(+[](GtkListBox *list, GtkListBoxRow *row, gpointer data) {
      auto *t = static_cast<RowTarget *>(data);
      t->splits->titleContent(GTK_WIDGET(list), row);
      if (row && g_object_get_data(G_OBJECT(row), "ngn-row")) {
        t->splits->chose(t->parent, GPOINTER_TO_INT(g_object_get_data(G_OBJECT(row), "ngn-row")));
      }
    }), target, [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
    g_signal_connect_data(box, "row-activated", G_CALLBACK(+[](GtkListBox *, GtkListBoxRow *row, gpointer data) {
      auto *t = static_cast<RowTarget *>(data);
      if (gpointer section = g_object_get_data(G_OBJECT(row), "ngn-section")) {
        Tag tag = GPOINTER_TO_INT(section);
        t->splits->fold(t->parent, tag, !t->splits->folded(t->parent, tag));
      }
    }), new RowTarget(*target), [](gpointer data, GClosure *) { delete static_cast<RowTarget *>(data); }, GConnectFlags(0));
    l.boxes.push_back(box);
  }
  // A tabs host's list fills its sidebar instead, once it is placed.
  const ViewData *parentData = backend_.data(parent);
  bool tabs = parentData && parentData->component == kTabsHost;
  for (size_t i = 0; i < lists.size(); i++) {
    l.folds.setList(lists[i]);
    if (!tabs && parentWidget && gtk_widget_get_parent(l.boxes[i]) != parentWidget) {
      gtk_widget_set_parent(l.boxes[i], parentWidget);
    }
    fill(parent, l, i);
  }
  if (tabs) {
    showTabList(parent);
    return;
  }
  layOut();
}

void SplitViews::fill(Tag parent, Lists &l, size_t index) {
  GtkWidget *box = l.boxes[index];
  const SourceList &list = l.lists[index];
  l.syncing = true;
  while (GtkWidget *row = gtk_widget_get_first_child(box)) {
    gtk_list_box_remove(GTK_LIST_BOX(box), row);
  }
  GtkListBoxRow *selected = nullptr;
  auto selectedTag = selectedRow(list);
  for (const auto &group : list.groups) {
    bool folded = group.collapsible && l.folds.folded(group.tag);
    if (!group.title.empty()) {
      GtkWidget *title = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
      GtkWidget *label = gtk_label_new(group.title.c_str());
      gtk_widget_add_css_class(label, "heading");
      gtk_widget_add_css_class(label, "dim-label");
      gtk_label_set_xalign(GTK_LABEL(label), 0);
      gtk_widget_set_hexpand(label, TRUE);
      gtk_box_append(GTK_BOX(title), label);
      if (group.collapsible) {
        gtk_box_append(GTK_BOX(title), gtk_image_new_from_icon_name(folded ? "pan-end-symbolic" : "pan-down-symbolic"));
      }
      GtkWidget *row = gtk_list_box_row_new();
      gtk_list_box_row_set_child(GTK_LIST_BOX_ROW(row), title);
      gtk_list_box_row_set_selectable(GTK_LIST_BOX_ROW(row), FALSE);
      gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), group.collapsible);
      gtk_widget_add_css_class(row, "ngn-section-title");
      gtk_accessible_update_property(GTK_ACCESSIBLE(row), GTK_ACCESSIBLE_PROPERTY_LABEL, group.title.c_str(), -1);
      if (group.collapsible) {
        g_object_set_data(G_OBJECT(row), "ngn-section", GINT_TO_POINTER(group.tag));
        gtk_accessible_update_state(GTK_ACCESSIBLE(row), GTK_ACCESSIBLE_STATE_EXPANDED, !folded, -1);
      }
      gtk_list_box_append(GTK_LIST_BOX(box), row);
    }
    if (folded) {
      continue;
    }
    for (const auto &r : group.rows) {
      GtkWidget *row = gtk_list_box_row_new();
      g_object_set_data(G_OBJECT(row), "ngn-row", GINT_TO_POINTER(r.tag));
      g_object_set_data_full(G_OBJECT(row), "ngn-label", g_strdup(r.label.c_str()), g_free);
      if (r.custom) {
        // The item's own views, in a slot of the row that is a container of its own.
        GtkWidget *slot = makeHostSlot();
        backend_.hostView(r.tag, slot);
        if (const ViewData *d = backend_.data(r.tag)) {
          backend_.hooks.containerRoot(r.tag, true);
          backend_.hooks.attachInput(slot, d->surfaceId, r.tag);
        }
        l.hosted.push_back(r.tag);
        gtk_list_box_row_set_child(GTK_LIST_BOX_ROW(row), slot);
      } else {
        GtkWidget *content = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
        // An SF Symbol has no Linux equivalent, so only an SVG icon is drawn.
        if (GtkWidget *icon = makeSvgIcon(r.svgIcon, kRowIconSize)) {
          gtk_box_append(GTK_BOX(content), icon);
        }
        GtkWidget *label = gtk_label_new(r.label.c_str());
        gtk_label_set_xalign(GTK_LABEL(label), 0);
        gtk_label_set_ellipsize(GTK_LABEL(label), PANGO_ELLIPSIZE_END);
        gtk_widget_set_hexpand(label, TRUE);
        gtk_box_append(GTK_BOX(content), label);
        if (!r.badge.empty()) {
          GtkWidget *badge = gtk_label_new(r.badge.c_str());
          gtk_widget_add_css_class(badge, "dim-label");
          gtk_box_append(GTK_BOX(content), badge);
        }
        gtk_list_box_row_set_child(GTK_LIST_BOX_ROW(row), content);
      }
      gtk_list_box_append(GTK_LIST_BOX(box), row);
      if (selectedTag == r.tag) {
        selected = GTK_LIST_BOX_ROW(row);
      }
    }
  }
  gtk_list_box_select_row(GTK_LIST_BOX(box), selected);
  // Said again: a refill that keeps the same row selected may emit nothing.
  titleContent(box, selected);
  l.syncing = false;
}

void SplitViews::titleContent(GtkWidget *within, GtkListBoxRow *row) {
  for (auto &[tag, s] : splits_) {
    GtkWidget *pane = s.sidebar >= 0 ? backend_.view(s.sidebar) : nullptr;
    if (s.tabs || !pane || !(within == pane || gtk_widget_is_ancestor(within, pane))) {
      continue;
    }
    // The sidebar's selected row, whichever of its lists holds it, not the row of the list that
    // asked: a list with nothing selected, filled after the one that has it, would clear the title.
    // The app selects one row in a sidebar; were there more, the first list's would title it.
    // A row the user picked, before the app hears of it, or else the item the app selects, which a
    // folded section shows no row for.
    // The row just selected, first: another list may still hold the one selected before it.
    const char *label = row ? static_cast<const char *>(g_object_get_data(G_OBJECT(row), "ngn-label")) : nullptr;
    for (const auto &[parent, l] : lists_) {
      for (size_t i = 0; i < l.boxes.size() && !label; i++) {
        GtkWidget *box = l.boxes[i];
        if (!(box == pane || gtk_widget_is_ancestor(box, pane))) {
          continue;
        }
        if (GtkListBoxRow *selected = gtk_list_box_get_selected_row(GTK_LIST_BOX(box))) {
          label = static_cast<const char *>(g_object_get_data(G_OBJECT(selected), "ngn-label"));
        } else if (i < l.lists.size()) {
          label = selectedLabel(l.lists[i]);
        }
      }
    }
    adw_navigation_page_set_title(adw_navigation_split_view_get_content(ADW_NAVIGATION_SPLIT_VIEW(s.view)), label ? label : "");
  }
}

void SplitViews::layOut() {
  for (auto &[parent, l] : lists_) {
    for (size_t i = 0; i < l.boxes.size() && i < l.lists.size(); i++) {
      std::optional<Rect> frame;
      for (const auto &group : l.lists[i].groups) {
        const ViewData *section = backend_.data(group.tag);
        if (!section) {
          continue;
        }
        Rect f = section->layout.frame;
        if (!frame) {
          frame = f;
        } else {
          Float left = std::min(frame->origin.x, f.origin.x), top = std::min(frame->origin.y, f.origin.y);
          Float right = std::max(frame->origin.x + frame->size.width, f.origin.x + f.size.width);
          Float bottom = std::max(frame->origin.y + frame->size.height, f.origin.y + f.size.height);
          frame = Rect{{left, top}, {right - left, bottom - top}};
        }
      }
      auto *held = static_cast<Rect *>(g_object_get_data(G_OBJECT(l.boxes[i]), "ngn-frame"));
      if (frame && held && *held != *frame) {
        *held = *frame;
        if (GtkWidget *p = gtk_widget_get_parent(l.boxes[i])) {
          gtk_widget_queue_allocate(p);
        }
      }
    }
  }
}

void SplitViews::chose(Tag parent, Tag row) {
  auto it = lists_.find(parent);
  if (it == lists_.end() || it->second.syncing) {
    return;
  }
  if (auto split = splits_.find(parent); split != splits_.end() && split->second.tabs) {
    chosenTab_ = {split->second.surfaceId, parent, row};
    if (choose_ == 0) {
      choose_ = g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer self) -> gboolean {
        auto *splits = static_cast<SplitViews *>(self);
        splits->choose_ = 0;
        auto chosen = splits->chosenTab_;
        splits->backend_.hooks.chooseTab(chosen.surfaceId, chosen.host, chosen.screen);
        return G_SOURCE_REMOVE;
      }, this, nullptr);
    }
    // At a compact width the choice brings the content forward.
    if (split->second.folding.compact()) {
      split->second.folding.chose();
      show(split->second);
    }
    return;
  }
  send(backend_.data(row), "sidebarSelect", folly::dynamic::object());
  // At a compact width the choice brings the content forward.
  for (auto &[tag, s] : splits_) {
    if (s.folding.compact() && s.sidebar >= 0) {
      if (GtkWidget *pane = backend_.view(s.sidebar), *list = backend_.view(parent); pane && list && (list == pane || gtk_widget_is_ancestor(list, pane))) {
        s.folding.chose();
        show(s);
      }
    }
  }
}

bool SplitViews::folded(Tag parent, Tag section) const {
  auto it = lists_.find(parent);
  return it != lists_.end() && it->second.folds.folded(section);
}

void SplitViews::fold(Tag parent, Tag section, bool folded) {
  auto it = lists_.find(parent);
  if (it == lists_.end()) {
    return;
  }
  auto &l = it->second;
  l.folds.fold(section, folded);
  // The section's layout follows: a folded one is only its title row.
  if (const ViewData *d = backend_.data(section)) {
    if (auto state = std::dynamic_pointer_cast<const ConcreteState<SidebarSectionState>>(d->state);
        state && state->getData().collapsed != folded) {
      state->updateState(SidebarSectionState{.collapsed = folded});
    }
  }
  // Rebuilt on the next idle, at most once: the row activated is the list's own until its signal
  // returns.
  if (l.refill == 0) {
    l.refill = g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer data) -> gboolean {
      auto *t = static_cast<RowTarget *>(data);
      if (auto it = t->splits->lists_.find(t->parent); it != t->splits->lists_.end()) {
        it->second.refill = 0;
      }
      t->splits->refill(t->parent);
      return G_SOURCE_REMOVE;
    }, new RowTarget{this, parent}, [](gpointer data) { delete static_cast<RowTarget *>(data); });
  }
}

void SplitViews::refill(Tag parent) {
  auto it = lists_.find(parent);
  if (it == lists_.end()) {
    return;
  }
  rebuild(parent, std::vector<SourceList>(it->second.lists));
}

GtkWidget *SplitViews::splitWidget(Tag split) const {
  auto it = splits_.find(split);
  return it == splits_.end() ? nullptr : it->second.view;
}

GtkWidget *SplitViews::contentButton(Tag split) const {
  auto it = splits_.find(split);
  return it == splits_.end() ? nullptr : it->second.contentButton;
}

AdwBreakpoint *SplitViews::breakpoint(Tag split) const {
  auto it = splits_.find(split);
  return it == splits_.end() ? nullptr : it->second.breakpoint;
}

std::vector<GtkWidget *> SplitViews::lists(Tag parent) const {
  auto it = lists_.find(parent);
  return it == lists_.end() ? std::vector<GtkWidget *>{} : it->second.boxes;
}

// --- Sizes -------------------------------------------------------------------------------------

void SplitViews::reportSizeFromSlot(Tag pane, int width, int height) {
  Size size{static_cast<Float>(width), static_cast<Float>(height)};
  reported_[pane] = size;
  // A tabs host's content slot sizes every screen still in it.
  auto split = splits_.find(pane);
  bool tabs = split != splits_.end() && split->second.tabs;
  bool changed = false;
  for (Tag target : tabs ? split->second.screens : std::vector<Tag>{pane}) {
    if (!tabs || backend_.isHosted(target)) {
      changed = sizes_.report(target, size) || changed;
    }
  }
  if (changed && flush_ == 0) {
    // Once a frame at most, however many allocations a resize takes.
    flush_ = g_idle_add_full(G_PRIORITY_DEFAULT, [](gpointer self) -> gboolean {
      auto *splits = static_cast<SplitViews *>(self);
      splits->flush_ = 0;
      splits->flushSizes();
      return G_SOURCE_REMOVE;
    }, this, nullptr);
  }
}

void SplitViews::flushSizes() {
  for (const auto &[tag, size] : sizes_.flush()) {
    const ViewData *d = backend_.data(tag);
    auto state = d ? std::dynamic_pointer_cast<const ConcreteState<SplitPaneState>>(d->state) : nullptr;
    if (state && state->getData().size != size) {
      state->updateState(SplitPaneState{.size = size});
    }
  }
}

std::optional<Size> SplitViews::paneSize(Tag pane) const {
  auto it = reported_.find(pane);
  return it == reported_.end() ? std::nullopt : std::optional(it->second);
}

} // namespace ngn::gtk
